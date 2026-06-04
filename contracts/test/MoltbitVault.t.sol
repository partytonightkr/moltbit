// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoltbitVault} from "../src/MoltbitVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract MoltbitVaultTest is Test {
    MockUSDC usdc;
    MoltbitVault vault;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address agent = makeAddr("agent");
    address venue = makeAddr("venue");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant ONE = 1e6; // 1 USDC

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(admin);
        vault = new MoltbitVault("Moltbit Funding Harvest", "mFNDH3", address(usdc), 2000, admin, keeper, agent);
        vm.prank(admin);
        vault.setVenue(venue, true);
        // The generic lifecycle/NAV tests below assert raw NAV mechanics; disable
        // the performance fee here so those numbers stay clean. Fee behaviour is
        // covered explicitly in the perf-fee tests, which re-enable it.
        vm.prank(admin);
        vault.setPerfFee(0);

        usdc.mint(alice, 100_000 * ONE);
        usdc.mint(bob, 100_000 * ONE);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    // deposit at genesis NAV mints 1:1
    function test_DepositMintsAtNav() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(10_000 * ONE, alice);
        assertEq(shares, 10_000 * ONE);
        assertEq(vault.balanceOf(alice), 10_000 * ONE);
        assertEq(vault.pricePerShare(), ONE);
        assertEq(vault.reportedAssets(), 10_000 * ONE);
    }

    // NAV up → new deposits get fewer shares; reconcile stays balanced
    function test_NavAppreciationAndReconcile() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);

        // strategy earns 20%: report 12k assets
        vm.prank(keeper);
        vault.reportNav(12_000 * ONE);
        assertEq(vault.pricePerShare(), 12 * ONE / 10); // 1.2 USDC/share

        vm.prank(bob);
        uint256 bobShares = vault.deposit(12_000 * ONE, bob);
        assertEq(bobShares, 10_000 * ONE); // 12k / 1.2 = 10k shares

        (bool balanced,) = vault.reconcile();
        assertTrue(balanced);
    }

    // full redeem lifecycle: request → close (24h) → claim (24h)
    function test_RedeemLifecycle() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);

        vm.prank(alice);
        uint256 id = vault.requestRedeem(4_000 * ONE);
        // shares burned immediately, liability struck
        assertEq(vault.balanceOf(alice), 6_000 * ONE);
        assertEq(vault.pendingLiability(), 4_000 * ONE);

        // cannot close early as a random caller
        vm.expectRevert();
        vault.closeTrades(id);

        // agent closes within window
        vm.prank(agent);
        vault.closeTrades(id);

        // cannot claim before claim window elapses
        vm.expectRevert(MoltbitVault.WindowNotElapsed.selector);
        vm.prank(alice);
        vault.claim(id);

        // after 24h claim
        vm.warp(block.timestamp + 24 hours);
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.claim(id);
        assertEq(usdc.balanceOf(alice) - balBefore, 4_000 * ONE);
        assertEq(vault.pendingLiability(), 0);
    }

    // forced unwind: anyone can close after the trade-close deadline (crank)
    function test_ForcedUnwindViaCrank() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(1_000 * ONE);

        vm.warp(block.timestamp + 24 hours); // close deadline passed
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vault.crank(ids); // permissionless
        (, , , , MoltbitVault.WStatus status) = _w(id);
        assertEq(uint8(status), uint8(MoltbitVault.WStatus.Claimable));
    }

    // agent can only push to a whitelisted venue, never an EOA
    function test_AgentCannotSendToEOA() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(agent);
        vm.expectRevert(MoltbitVault.NotAllowedVenue.selector);
        vault.allocate(bob, 1_000 * ONE);

        // but can to the venue
        vm.prank(agent);
        vault.allocate(venue, 1_000 * ONE);
        assertEq(usdc.balanceOf(venue), 1_000 * ONE);
        // NAV unchanged: funds still counted
        assertEq(vault.reportedAssets(), 10_000 * ONE);
    }

    // drawdown beyond ddHaltBps trips the circuit breaker (auto-pause)
    function test_CircuitBreakerTripsOnDrawdown() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        // -25% (beyond -20% halt)
        vm.prank(keeper);
        vault.reportNav(7_500 * ONE);
        assertTrue(vault.paused());

        // deposits blocked while paused
        vm.prank(bob);
        vm.expectRevert(MoltbitVault.VaultPaused.selector);
        vault.deposit(1_000 * ONE, bob);

        // exits still allowed
        vm.prank(alice);
        vault.requestRedeem(1_000 * ONE);
    }

    // ---------------------------------------------------------------
    //  Performance fee (10% on gains above the high-water mark)
    // ---------------------------------------------------------------

    // a new high accrues fee shares to the recipient worth ~10% of the gain
    function test_PerfFeeAccruesOnNewHigh() public {
        vm.prank(admin);
        vault.setPerfFee(1000); // 10%

        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);

        // +10% → 1,000 USDC gain above HWM; 10% fee = ~100 USDC to admin
        vm.prank(keeper);
        vault.reportNav(11_000 * ONE);

        uint256 feeShares = vault.balanceOf(admin);
        assertGt(feeShares, 0);
        // fee recipient's shares are worth ~100 USDC (within 0.01)
        assertApproxEqAbs(vault.convertToAssets(feeShares), 100 * ONE, 1e4);
        // alice keeps her shares; net of the fee dilution she holds ~10,900 USDC
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(alice)), 10_900 * ONE, 1e6);

        // minting fee shares preserves the reconcile identity
        (bool balanced,) = vault.reconcile();
        assertTrue(balanced);
    }

    // fee only charged on NEW highs — a recovery back to a prior high is free
    function test_PerfFeeOnlyChargedAboveHighWater() public {
        vm.prank(admin);
        vault.setPerfFee(1000);
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);

        vm.prank(keeper);
        vault.reportNav(11_000 * ONE); // new high → fee
        uint256 sharesAfterHigh = vault.balanceOf(admin);
        assertGt(sharesAfterHigh, 0);

        vm.prank(keeper);
        vault.reportNav(10_500 * ONE); // dip below HWM → no new fee
        assertEq(vault.balanceOf(admin), sharesAfterHigh);

        vm.prank(keeper);
        vault.reportNav(11_000 * ONE); // recover to prior high → still no fee
        assertEq(vault.balanceOf(admin), sharesAfterHigh);
    }

    // zero-fee config mints nothing even on a big gain
    function test_PerfFeeZeroMintsNothing() public {
        // setUp already set perfFee to 0
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(keeper);
        vault.reportNav(15_000 * ONE);
        assertEq(vault.balanceOf(admin), 0);
    }

    // ---------------------------------------------------------------
    //  NAV delta guardrail (bounds a rogue/buggy keeper)
    // ---------------------------------------------------------------

    function test_NavDeltaBoundRejectsLargeMove() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice); // baseline 10,000

        vm.prank(admin);
        vault.setMaxNavDelta(1000); // ±10%

        vm.prank(keeper);
        vm.expectRevert(MoltbitVault.NavDeltaTooLarge.selector);
        vault.reportNav(12_000 * ONE); // +20% rejected

        vm.prank(keeper);
        vm.expectRevert(MoltbitVault.NavDeltaTooLarge.selector);
        vault.reportNav(8_000 * ONE); // -20% rejected

        vm.prank(keeper);
        vault.reportNav(11_000 * ONE); // +10% exactly at bound → allowed
        assertEq(vault.reportedAssets(), 11_000 * ONE);
    }

    function test_NavDeltaBoundDisabledAllowsAnyMove() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(admin);
        vault.setMaxNavDelta(0); // disabled
        vm.prank(keeper);
        vault.reportNav(50_000 * ONE); // +400% would normally be rejected
        assertEq(vault.reportedAssets(), 50_000 * ONE);
    }

    // ---------------------------------------------------------------
    //  Defaults + access control on the new setters
    // ---------------------------------------------------------------

    function test_ConstructorDefaults() public {
        vm.prank(admin);
        MoltbitVault v = new MoltbitVault("X", "X", address(usdc), 2000, admin, keeper, agent);
        assertEq(v.perfFeeBps(), 1000);
        assertEq(v.feeRecipient(), admin);
        assertEq(v.maxNavDeltaBps(), 5000);
    }

    function test_OnlyAdminCanSetFeeAndNavParams() public {
        vm.expectRevert();
        vm.prank(alice);
        vault.setPerfFee(500);

        vm.expectRevert();
        vm.prank(alice);
        vault.setFeeRecipient(bob);

        vm.expectRevert();
        vm.prank(alice);
        vault.setMaxNavDelta(1000);

        // fee cap is enforced
        vm.prank(admin);
        vm.expectRevert(MoltbitVault.FeeTooHigh.selector);
        vault.setPerfFee(3001);

        // admin can set within the cap
        vm.prank(admin);
        vault.setPerfFee(3000);
        assertEq(vault.perfFeeBps(), 3000);
    }

    function _w(uint256 id)
        internal
        view
        returns (address, uint256, uint64, uint64, MoltbitVault.WStatus)
    {
        (address owner, uint256 assets, uint64 cd, uint64 cl, MoltbitVault.WStatus s) = vault.withdrawals(id);
        return (owner, assets, cd, cl, s);
    }
}
