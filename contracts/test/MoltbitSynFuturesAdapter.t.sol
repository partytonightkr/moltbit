// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MoltbitVault} from "../src/MoltbitVault.sol";
import {MoltbitSynFuturesAdapter} from "../src/adapters/MoltbitSynFuturesAdapter.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// Decodes the packed bytes32 (token | quantity<<160) and moves USDC, like the Gate.
contract MockSynGate {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    constructor(address u) { usdc = IERC20(u); }
    function deposit(bytes32 arg) external {
        address token = address(uint160(uint256(arg)));
        uint96 q = uint96(uint256(arg) >> 160);
        require(token == address(usdc), "bad token");
        usdc.safeTransferFrom(msg.sender, address(this), q);
    }
    function withdraw(bytes32 arg) external {
        uint96 q = uint96(uint256(arg) >> 160);
        usdc.safeTransfer(msg.sender, q);
    }
}

/// Decodes the packed trade pages so the test can assert the encoding round-trips.
contract MockSynInstrument {
    int128 public lastSize;
    uint128 public lastAmount;
    uint32 public lastExpiry;
    int24 public lastTick;
    function trade(bytes32[2] calldata pages) external {
        uint256 p0 = uint256(pages[0]);
        lastExpiry = uint32(p0);
        lastTick = int24(uint24(p0 >> 32));
        uint256 p1 = uint256(pages[1]);
        lastAmount = uint128(p1);
        lastSize = int128(uint128(p1 >> 128));
    }
}

contract MoltbitSynFuturesAdapterTest is Test {
    uint256 constant ONE = 1e6;

    MockUSDC usdc;
    MockSynGate gate;
    MockSynInstrument instrument;
    MoltbitVault vault;
    MoltbitSynFuturesAdapter adapter;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        gate = new MockSynGate(address(usdc));
        instrument = new MockSynInstrument();

        vm.prank(admin);
        vault = new MoltbitVault("Moltbit SynFutures", "mSYN", address(usdc), 2000, admin, keeper, agent);
        adapter = new MoltbitSynFuturesAdapter(
            address(vault), address(usdc), address(gate), address(instrument), admin, keeper
        );
        vm.prank(admin);
        vault.setVenue(address(adapter), true);

        usdc.mint(alice, 100_000 * ONE);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    // allocate → deposit to Gate → trade (packed) → withdraw → returnFromVenue
    function test_PackAndMarginLoop() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);
        vm.prank(agent);
        vault.allocate(address(adapter), 5_000 * ONE);
        assertEq(adapter.idleUsdc(), 5_000 * ONE);

        // deposit 5k USDC (6dp) margin into the Gate
        vm.prank(keeper);
        adapter.depositMargin(uint96(5_000 * ONE));
        assertEq(adapter.idleUsdc(), 0);
        assertEq(usdc.balanceOf(address(gate)), 5_000 * ONE);

        // open a long: size +2 (18dp), margin 5k (18dp), tick 123, perp expiry
        int128 size = int128(int256(2 * 1e18));
        uint128 amount = uint128(5_000 * 1e18);
        vm.prank(keeper);
        adapter.trade(size, amount, int24(123), uint32(block.timestamp + 60));
        assertEq(instrument.lastSize(), size);
        assertEq(instrument.lastAmount(), amount);
        assertEq(instrument.lastExpiry(), type(uint32).max); // PERP_EXPIRY
        assertEq(instrument.lastTick(), int24(123));

        // pull margin back and return to the vault
        vm.prank(keeper);
        adapter.withdrawMargin(uint96(5_000 * ONE));
        assertEq(adapter.idleUsdc(), 5_000 * ONE);
        vm.prank(keeper);
        adapter.returnIdleToVault();
        assertEq(usdc.balanceOf(address(vault)), 10_000 * ONE); // 5k left + 5k back
    }

    // short = negative size; negative tick — both round-trip through the packing
    function test_SignedFieldsRoundTrip() public {
        int128 size = int128(-int256(3 * 1e18));
        vm.prank(keeper);
        adapter.trade(size, uint128(1e18), int24(-50), uint32(1000));
        assertEq(instrument.lastSize(), size);
        assertEq(instrument.lastTick(), int24(-50));
        assertEq(instrument.lastExpiry(), type(uint32).max);
    }

    function test_AccessControl() public {
        vm.expectRevert();
        vm.prank(alice);
        adapter.trade(1, 1, 0, 0);

        vm.expectRevert();
        vm.prank(alice);
        adapter.depositMargin(1);
    }
}
