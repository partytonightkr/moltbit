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
 * @notice Avantis (Base) perp DEX — the gTrade/Tigris-style trading contract. Exact ABI
 *         must be PINNED FROM THE DEPLOYED CONTRACT ON BASESCAN before mainnet use; the
 *         field set/decimals below match the Avantis SDK `OpenTradeParams`
 *         (positionSizeUSDC 6dp; openPrice/leverage/tp/sl 10dp) but the on-chain struct
 *         layout and selectors are authoritative. Treated as an integration seam.
 *
 *  ⚠️ VERIFY against https://basescan.org before deploying with real funds.
 */
interface IAvantisTrading {
    struct Trade {
        address trader;
        uint256 pairIndex;
        uint256 index;
        uint256 initialPosToken; // bookkeeping; set 0 on open
        uint256 positionSizeUSDC; // 6dp collateral
        uint256 openPrice; // 10dp (0 = market)
        bool buy; // long/short
        uint256 leverage; // 10dp
        uint256 tp; // 10dp (0 = none)
        uint256 sl; // 10dp (0 = none)
        uint256 timestamp;
    }

    function openTrade(Trade calldata t, uint8 orderType, uint256 slippageP, uint256 executionFee) external payable;
    function closeTradeMarket(uint256 pairIndex, uint256 index, uint256 collateralToClose, uint256 executionFee)
        external
        payable;
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

    event Opened(uint256 indexed pairIndex, bool buy, uint256 marginUsdc, uint256 leverage);
    event Closed(uint256 indexed pairIndex, uint256 indexed index, uint256 collateralToClose);
    event ReturnedToVault(uint256 amount);

    error NothingIdle();

    constructor(address vault_, address usdc_, address trading_, address admin, address keeper) {
        vault = vault_;
        usdc = IERC20(usdc_);
        trading = IAvantisTrading(trading_);
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
        uint256 slippageP, // 10dp
        uint256 executionFee
    ) external payable onlyRole(KEEPER_ROLE) nonReentrant {
        // approve exactly the margin Avantis will pull as collateral
        usdc.forceApprove(address(trading), marginUsdc);
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
            timestamp: block.timestamp
        });
        trading.openTrade{value: executionFee}(t, orderType, slippageP, executionFee);
        emit Opened(pairIndex, buy, marginUsdc, leverage);
    }

    /// @notice Close (or partially close) an open Avantis position at market.
    function closeTrade(uint256 pairIndex, uint256 index, uint256 collateralToClose, uint256 executionFee)
        external
        payable
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        trading.closeTradeMarket{value: executionFee}(pairIndex, index, collateralToClose, executionFee);
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
