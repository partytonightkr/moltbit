// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMoltbitVenueAdapter} from "./IMoltbitVenueAdapter.sol";

/// Minimal slice of MoltbitVault the adapter calls back into.
interface IMoltbitVault {
    function returnFromVenue(uint256 assets) external;
}

/**
 * @notice Avantis (Base) perp DEX — gTrade/Tigris-style. Signatures + struct verified
 *         against the official Avantis integration SDK (Avantis-Labs/avantisfi-integration):
 *           - openTrade(Trade, uint8 orderType, uint256 slippageP) is PAYABLE; the keeper-bot
 *             execution fee is sent as msg.value (wei), NOT a function argument.
 *           - the Trade tuple is 11 fields ending at `timestamp` (the SDK's 12th `liqPrice`
 *             field is NOT part of the on-chain struct).
 *           - collateral (USDC) is approved to TradingStorage, not Trading.
 *         Decimals: positionSizeUSDC 6dp; openPrice/leverage/tp/sl/slippageP 10dp.
 *
 *  Base mainnet: Trading 0x44914408af82bc9983bbb330e3578e1105e11d4e,
 *                TradingStorage 0x8a311D7048c35985aa31C131B9A13e03a5f7422d,
 *                USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
 *  orderType enum: MARKET=0, STOP_LIMIT=1, LIMIT=2, MARKET_PNL=3.
 *  ⚠️ Still re-verify enum names / internal transfer logic against the Basescan source
 *     before real size; SDK ABIs are authoritative for encoding but not the deployed source.
 */
interface IAvantisTrading {
    struct Trade {
        address trader;
        uint256 pairIndex;
        uint256 index; // 0 on open
        uint256 initialPosToken; // 0 on open
        uint256 positionSizeUSDC; // 6dp collateral
        uint256 openPrice; // 10dp (0 = market)
        bool buy; // long/short
        uint256 leverage; // 10dp
        uint256 tp; // 10dp (0 = none)
        uint256 sl; // 10dp (0 = none)
        uint256 timestamp; // 0 on open
    }

    function openTrade(Trade calldata t, uint8 orderType, uint256 slippageP) external payable;
    function closeTradeMarket(uint256 pairIndex, uint256 index, uint256 amount) external payable returns (uint256);
}

/**
 * @title MoltbitAvantisAdapter
 * @notice On-chain venue adapter: opens/closes Avantis perps with USDC the vault pushed
 *         in via `allocate(adapter, margin)`, and returns freed USDC to the vault. The
 *         adapter — not an EOA — is the position owner (`trader = address(this)`), so the
 *         vault's "funds can only go to a whitelisted contract" guarantee is preserved.
 *
 * @dev    ⚠️ UNAUDITED REFERENCE. Pin the Avantis ABI/addresses from Basescan, test on a
 *         small position first, and audit the adapter before real third-party capital.
 *         NAV/PnL of the open position is reported by the keeper via `MoltbitVault.reportNav`
 *         (off-chain accounting), as the rest of the system already does; this adapter only
 *         exposes its idle USDC on-chain.
 */
contract MoltbitAvantisAdapter is IMoltbitVenueAdapter, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE"); // server wallet / operator

    address public immutable override vault;
    IERC20 public immutable usdc;
    IAvantisTrading public immutable trading;
    /// @notice USDC collateral is approved to TradingStorage (Avantis pulls it here), not Trading.
    address public immutable tradingStorage;

    event Opened(uint256 indexed pairIndex, bool buy, uint256 marginUsdc, uint256 leverage);
    event Closed(uint256 indexed pairIndex, uint256 indexed index, uint256 collateralToClose);
    event ReturnedToVault(uint256 amount);

    error NothingIdle();

    constructor(address vault_, address usdc_, address trading_, address tradingStorage_, address admin, address keeper) {
        vault = vault_;
        usdc = IERC20(usdc_);
        trading = IAvantisTrading(trading_);
        tradingStorage = tradingStorage_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, keeper);
    }

    function asset() external view override returns (address) {
        return address(usdc);
    }

    function idleUsdc() public view override returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Open an Avantis position using `marginUsdc` of the adapter's idle USDC.
     *         Caller (keeper/server wallet) sets price/leverage/side per the strategy.
     * @dev    `executionFee` is forwarded as msg.value to the keeper-bot execution layer.
     */
    function openTrade(
        uint256 pairIndex,
        bool buy,
        uint256 marginUsdc, // 6dp
        uint256 openPrice, // 10dp (0 = market)
        uint256 leverage, // 10dp
        uint256 tp, // 10dp
        uint256 sl, // 10dp
        uint8 orderType,
        uint256 slippageP // 10dp
    ) external payable onlyRole(KEEPER_ROLE) nonReentrant {
        // approve exactly the margin Avantis pulls as collateral (into TradingStorage)
        usdc.forceApprove(tradingStorage, marginUsdc);
        IAvantisTrading.Trade memory t = IAvantisTrading.Trade({
            trader: address(this),
            pairIndex: pairIndex,
            index: 0,
            initialPosToken: 0,
            positionSizeUSDC: marginUsdc,
            openPrice: openPrice,
            buy: buy,
            leverage: leverage,
            tp: tp,
            sl: sl,
            timestamp: 0
        });
        // execution fee for the keeper-bot layer is forwarded as msg.value
        trading.openTrade{value: msg.value}(t, orderType, slippageP);
        emit Opened(pairIndex, buy, marginUsdc, leverage);
    }

    /// @notice Close (or partially close) an open Avantis position at market.
    ///         `collateralToClose` is 6dp USDC; execution fee is forwarded as msg.value.
    function closeTrade(uint256 pairIndex, uint256 index, uint256 collateralToClose)
        external
        payable
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        trading.closeTradeMarket{value: msg.value}(pairIndex, index, collateralToClose);
        emit Closed(pairIndex, index, collateralToClose);
    }

    /// @notice Return all idle USDC to the vault via `returnFromVenue`. Keeper or vault only.
    function returnIdleToVault() external override nonReentrant returns (uint256 amount) {
        require(hasRole(KEEPER_ROLE, msg.sender) || msg.sender == vault, "not authorized");
        amount = usdc.balanceOf(address(this));
        if (amount == 0) revert NothingIdle();
        // returnFromVenue pulls via transferFrom — approve the vault to take it.
        usdc.forceApprove(vault, amount);
        IMoltbitVault(vault).returnFromVenue(amount);
        emit ReturnedToVault(amount);
    }

    /// @notice Rescue native gas refunded by the keeper-bot layer (execution-fee change).
    function sweepNative(address payable to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "sweep failed");
    }

    receive() external payable {}
}
