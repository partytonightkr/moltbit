// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMoltbitVenueAdapter} from "./IMoltbitVenueAdapter.sol";

interface IMoltbitVault2 {
    function returnFromVenue(uint256 assets) external;
}

/**
 * @notice SynFutures v3 (Oyster AMM, Base) — Gate + per-market Instrument. Calldata is
 *         BIT-PACKED bytes32, verified against the official SDK (SynFutures/oyster-sdk,
 *         src/common/util.ts + abis). Layouts:
 *           Gate.deposit/withdraw(bytes32):
 *             bits[0..159]   = token address (USDC)
 *             bits[160..255] = quantity (uint96, in the token's own decimals → USDC 6dp)
 *           Instrument.trade(bytes32[2]):
 *             page0: [0..31]=expiry(uint32; PERP=2^32-1) [32..55]=limitTick(int24)
 *                    [56..87]=deadline(uint32)
 *             page1: [0..127]=amount(uint128, margin 18dp) [128..255]=size(int128, signed
 *                    base size, 18dp; sign = direction: long +, short −)
 *         Margin flow: USDC.approve(Gate) → Gate.deposit → Instrument.trade (draws from the
 *         Gate balance). Close = trade with opposite-sign size. Withdraw margin via Gate.
 *
 * @dev    ⚠️ UNAUDITED REFERENCE. The `limitTick` (price→tick) and `size`/`amount` (18dp,
 *         oracle-dependent) MUST be computed off-chain with the SynFutures SDK by the keeper —
 *         they can't be derived on-chain. The per-market `instrument` address is deployed per
 *         base/quote/oracle; resolve it from the SynFutures docs/Observer, not by guessing.
 *         Re-verify against the Basescan source before real funds.
 *
 *  Base: Gate 0x208B443983D8BcC8578e9D86Db23FbA547071270 ; Instrument = per market.
 */
contract MoltbitSynFuturesAdapter is IMoltbitVenueAdapter, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    uint32 public constant PERP_EXPIRY = type(uint32).max; // 4294967295

    address public immutable override vault;
    IERC20 public immutable usdc;
    address public immutable gate;
    address public immutable instrument; // per-market

    event MarginDeposited(uint96 quantity);
    event Traded(int128 size, uint128 amount, int24 limitTick);
    event MarginWithdrawn(uint96 quantity);
    event ReturnedToVault(uint256 amount);

    error NothingIdle();

    constructor(address vault_, address usdc_, address gate_, address instrument_, address admin, address keeper) {
        vault = vault_;
        usdc = IERC20(usdc_);
        gate = gate_;
        instrument = instrument_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, keeper);
    }

    function asset() external view override returns (address) {
        return address(usdc);
    }

    function idleUsdc() public view override returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ---- bit packing (matches oyster-sdk encoders) ---------------------------
    function _packGate(uint96 quantity) internal view returns (bytes32) {
        return bytes32((uint256(quantity) << 160) | uint256(uint160(address(usdc))));
    }

    function _packTrade(int128 size, uint128 amount, int24 limitTick, uint32 deadline)
        internal
        pure
        returns (bytes32[2] memory pages)
    {
        // page0: expiry | limitTick<<32 | deadline<<56
        pages[0] = bytes32(
            uint256(PERP_EXPIRY) | (uint256(uint24(limitTick)) << 32) | (uint256(deadline) << 56)
        );
        // page1: amount | size<<128 (size as signed int128, two's-complement in 128 bits)
        pages[1] = bytes32(uint256(amount) | (uint256(uint128(size)) << 128));
    }

    // ---- keeper operations ---------------------------------------------------

    /// @notice Deposit `quantity` USDC (6dp) of idle margin into the Gate.
    function depositMargin(uint96 quantity) external onlyRole(KEEPER_ROLE) nonReentrant {
        usdc.forceApprove(gate, quantity);
        (bool ok,) = gate.call(abi.encodeWithSignature("deposit(bytes32)", _packGate(quantity)));
        require(ok, "gate.deposit failed");
        emit MarginDeposited(quantity);
    }

    /// @notice Trade on the Instrument. `size` signed (long +, short −) opens or closes;
    ///         `amount` is margin (18dp); `limitTick`/`deadline` from the SDK off-chain.
    function trade(int128 size, uint128 amount, int24 limitTick, uint32 deadline)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        bytes32[2] memory pages = _packTrade(size, amount, limitTick, deadline);
        (bool ok,) = instrument.call(abi.encodeWithSignature("trade(bytes32[2])", pages));
        require(ok, "instrument.trade failed");
        emit Traded(size, amount, limitTick);
    }

    /// @notice Withdraw `quantity` USDC (6dp) of margin from the Gate back to the adapter.
    function withdrawMargin(uint96 quantity) external onlyRole(KEEPER_ROLE) nonReentrant {
        (bool ok,) = gate.call(abi.encodeWithSignature("withdraw(bytes32)", _packGate(quantity)));
        require(ok, "gate.withdraw failed");
        emit MarginWithdrawn(quantity);
    }

    /// @notice Return all idle USDC to the vault via `returnFromVenue`. Keeper or vault only.
    function returnIdleToVault() external override nonReentrant returns (uint256 amount) {
        require(hasRole(KEEPER_ROLE, msg.sender) || msg.sender == vault, "not authorized");
        amount = usdc.balanceOf(address(this));
        if (amount == 0) revert NothingIdle();
        usdc.forceApprove(vault, amount);
        IMoltbitVault2(vault).returnFromVenue(amount);
        emit ReturnedToVault(amount);
    }
}
