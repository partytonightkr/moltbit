// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MoltbitVault} from "../src/MoltbitVault.sol";
import {MoltbitAvantisAdapter, IAvantisTrading} from "../src/adapters/MoltbitAvantisAdapter.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// Minimal Avantis stand-in: openTrade locks the posted margin; closeTradeMarket
/// returns the requested collateral plus a configurable PnL back to the caller.
contract MockAvantisTrading is IAvantisTrading {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    int256 public pnlOnClose; // signed USDC(6dp) added/removed at close

    constructor(address usdc_) { usdc = IERC20(usdc_); }
    function setPnl(int256 p) external { pnlOnClose = p; }

    function openTrade(Trade calldata t, uint8, uint256, uint256) external payable override {
        // pull the collateral the adapter approved (margin lock)
        usdc.safeTransferFrom(msg.sender, address(this), t.positionSizeUSDC);
    }

    function closeTradeMarket(uint256, uint256, uint256 collateralToClose, uint256) external payable override {
        uint256 payout = pnlOnClose >= 0
            ? collateralToClose + uint256(pnlOnClose)
            : collateralToClose - uint256(-pnlOnClose);
        usdc.safeTransfer(msg.sender, payout);
    }
}

contract MoltbitAvantisAdapterTest is Test {
    uint256 constant ONE = 1e6;

    MockUSDC usdc;
    MockAvantisTrading trading;
    MoltbitVault vault;
    MoltbitAvantisAdapter adapter;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        trading = new MockAvantisTrading(address(usdc));

        vm.prank(admin);
        vault = new MoltbitVault("Moltbit Avantis", "mAVT", address(usdc), 2000, admin, keeper, agent);

        adapter = new MoltbitAvantisAdapter(address(vault), address(usdc), address(trading), admin, keeper);

        // whitelist the adapter as the vault's venue
        vm.prank(admin);
        vault.setVenue(address(adapter), true);

        // fund alice + the mock's PnL buffer
        usdc.mint(alice, 100_000 * ONE);
        usdc.mint(address(trading), 100_000 * ONE); // so it can pay profit on close
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    // allocate → open → close (profit) → returnIdleToVault completes the loop
    function test_FullTradeLoop() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        assertEq(usdc.balanceOf(address(vault)), 10_000 * ONE);

        // agent pushes 5k margin to the adapter (the whitelisted venue)
        vm.prank(agent);
        vault.allocate(address(adapter), 5_000 * ONE);
        assertEq(adapter.idleUsdc(), 5_000 * ONE);
        assertEq(usdc.balanceOf(address(vault)), 5_000 * ONE);

        // keeper opens a 5k-margin long; the mock locks the margin
        vm.prank(keeper);
        adapter.openTrade(0, true, 5_000 * ONE, 0, 5 * 1e10, 0, 0, 0, 0, 0);
        assertEq(adapter.idleUsdc(), 0);
        assertEq(usdc.balanceOf(address(trading)), 105_000 * ONE); // buffer + locked margin

        // strategy made +500 USDC; keeper closes at market
        trading.setPnl(int256(500 * ONE));
        vm.prank(keeper);
        adapter.closeTrade(0, 0, 5_000 * ONE, 0);
        assertEq(adapter.idleUsdc(), 5_500 * ONE);

        // sweep the freed USDC back into the vault
        vm.prank(keeper);
        uint256 moved = adapter.returnIdleToVault();
        assertEq(moved, 5_500 * ONE);
        assertEq(adapter.idleUsdc(), 0);
        // 5k left in vault + 5.5k returned = 10.5k (the +0.5k is recognized via reportNav)
        assertEq(usdc.balanceOf(address(vault)), 10_500 * ONE);
    }

    // a loss path returns less than the margin
    function test_LossPathReturnsLess() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(agent);
        vault.allocate(address(adapter), 4_000 * ONE);
        vm.prank(keeper);
        adapter.openTrade(0, false, 4_000 * ONE, 0, 3 * 1e10, 0, 0, 0, 0, 0);

        trading.setPnl(-int256(1_000 * ONE)); // -1000 USDC
        vm.prank(keeper);
        adapter.closeTrade(0, 0, 4_000 * ONE, 0);
        assertEq(adapter.idleUsdc(), 3_000 * ONE);

        vm.prank(keeper);
        adapter.returnIdleToVault();
        assertEq(usdc.balanceOf(address(vault)), 9_000 * ONE); // 6k + 3k back
    }

    // only the keeper may open/close/return
    function test_AccessControl() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(agent);
        vault.allocate(address(adapter), 1_000 * ONE);

        vm.expectRevert();
        vm.prank(alice);
        adapter.openTrade(0, true, 1_000 * ONE, 0, 2 * 1e10, 0, 0, 0, 0, 0);

        vm.expectRevert();
        vm.prank(alice);
        adapter.closeTrade(0, 0, 1_000 * ONE, 0);

        // keeper can; vault can also pull idle back
        vm.prank(keeper);
        uint256 moved = adapter.returnIdleToVault();
        assertEq(moved, 1_000 * ONE);
    }

    // the vault's non-custodial guarantee still blocks pushing funds to an EOA
    function test_VaultStillBlocksEOA() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(agent);
        vm.expectRevert(MoltbitVault.NotAllowedVenue.selector);
        vault.allocate(alice, 1_000 * ONE); // alice is an EOA, not the whitelisted adapter
    }
}
