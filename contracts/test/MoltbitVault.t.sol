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

    function _w(uint256 id)
        internal
        view
        returns (address, uint256, uint64, uint64, MoltbitVault.WStatus)
    {
        (address owner, uint256 assets, uint64 cd, uint64 cl, MoltbitVault.WStatus s) = vault.withdrawals(id);
        return (owner, assets, cd, cl, s);
    }
}
