// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltbitVault
 * @notice One vault per strategy. Depositors put in USDC and receive shares
 *         minted at the current NAV. An agent may deploy idle USDC to a
 *         whitelisted trading venue but can NEVER move funds to an arbitrary
 *         address — the non-custodial guarantee surfaced in the UI.
 *
 *         This is the on-chain expression of `moltbit-app/lib/settlement.js`:
 *           deposit  → NAV strike → mint shares          (strikeDeposit)
 *           redeem   → burn at NAV → 24h trade-close      (requestWithdrawal)
 *                    → 24h claim window                   (closeTrades)
 *                    → settle / claim                     (claim)
 *           reconcile: Σ shares × NAV == reportedAssets
 *           circuit breaker: drawdown beyond ddHaltBps auto-pauses
 *           performance fee: perfFeeBps of gains above the high-water mark,
 *                            accrued as minted shares on each new high
 *           keeper guardrail: per-report NAV moves bounded by maxNavDeltaBps
 *
 * @dev    ⚠️ UNAUDITED REFERENCE IMPLEMENTATION. Do not deploy to mainnet with
 *         real third-party funds before a professional audit AND legal sign-off.
 *         NAV here is reported by a trusted KEEPER (off-chain accounting of
 *         venue positions). Per-report deltas are now bounded (maxNavDeltaBps),
 *         but a production system should harden NAV reporting further
 *         (e.g. signed venue attestations, multi-keeper, timelocks).
 */
contract MoltbitVault is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----- roles -----
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE"); // NAV + settlement
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE"); // trade-only

    // ----- settlement windows (mirror settlement.js) -----
    uint256 public constant TRADE_CLOSE = 24 hours; // agent unwinds
    uint256 public constant CLAIM_DELAY = 24 hours; // depositor claim opens after

    // ----- accounting -----
    IERC20 public immutable usdc; // 6-decimals asset
    uint256 private constant NAV_ONE = 1e6; // 1 share priced in USDC units (6dp)

    /// @notice Total strategy value in USDC units, INCLUDING funds deployed to
    ///         venues. Set by the keeper each epoch. This is the NAV numerator.
    uint256 public reportedAssets;

    /// @notice Drawdown halt threshold in basis points (e.g. 2000 = -20%).
    uint256 public ddHaltBps;

    /// @notice High-water mark of price-per-share (scaled 1e6). Used both for the
    ///         drawdown circuit breaker and as the threshold above which the
    ///         performance fee accrues (so depositors are only charged on net
    ///         new gains, never on a recovery back to a prior high).
    uint256 public highWaterPps;

    // ----- performance fee (the 10% surfaced in the UI) -----
    /// @notice Performance fee in basis points charged on gains above the
    ///         high-water mark (1000 = 10%). Paid as freshly minted shares to
    ///         `feeRecipient`, diluting holders by exactly the fee — no USDC
    ///         leaves the vault on accrual, and the fee recipient redeems through
    ///         the same NAV-struck queue as anyone else.
    uint256 public perfFeeBps;
    /// @notice Recipient of accrued performance-fee shares (manager/treasury).
    address public feeRecipient;
    uint256 public constant MAX_PERF_FEE_BPS = 3000; // hard cap: 30%

    // ----- NAV reporting guardrail -----
    /// @notice Max allowed per-epoch NAV move as bps of the current
    ///         `reportedAssets` (5000 = ±50%). Bounds a compromised or buggy
    ///         keeper so a single report cannot arbitrarily reprice shares.
    ///         Set to 0 to disable the bound.
    uint256 public maxNavDeltaBps;

    bool public paused; // deposits + agent allocation halted; exits still allowed

    // ----- venue allowlist (agent can only push funds here) -----
    mapping(address => bool) public allowedVenue;

    // ----- withdrawal queue -----
    enum WStatus {
        None,
        Settling, // burned at NAV, agent in trade-close window
        Claimable, // liquidity freed, claim window open
        Settled
    }

    struct Withdrawal {
        address owner;
        uint256 assets; // USDC owed (struck at request NAV)
        uint64 closeDeadline; // settling -> claimable
        uint64 claimDeadline; // claimable -> settled
        WStatus status;
    }

    Withdrawal[] public withdrawals;
    uint256 public pendingLiability; // Σ assets owed but not yet claimed

    // ----- events -----
    event Deposited(address indexed user, uint256 assets, uint256 shares, uint256 pps);
    event RedeemRequested(uint256 indexed id, address indexed user, uint256 shares, uint256 assets);
    event TradesClosed(uint256 indexed id, uint64 claimDeadline);
    event Claimed(uint256 indexed id, address indexed user, uint256 assets);
    event NavReported(uint256 reportedAssets, uint256 pps);
    event Allocated(address indexed venue, uint256 assets);
    event Returned(address indexed venue, uint256 assets);
    event VenueSet(address indexed venue, bool allowed);
    event CircuitTripped(uint256 ppsDrawdownBps);
    event PausedSet(bool paused);
    event PerfFeeAccrued(address indexed recipient, uint256 feeAssets, uint256 feeShares);
    event PerfFeeSet(uint256 bps);
    event FeeRecipientSet(address indexed recipient);
    event MaxNavDeltaSet(uint256 bps);

    error NotAllowedVenue();
    error VaultPaused();
    error WindowNotElapsed();
    error BadState();
    error ZeroAmount();
    error NavDeltaTooLarge();
    error FeeTooHigh();

    constructor(
        string memory name_,
        string memory symbol_,
        address usdc_,
        uint256 ddHaltBps_,
        address admin,
        address keeper,
        address agent
    ) ERC20(name_, symbol_) {
        usdc = IERC20(usdc_);
        ddHaltBps = ddHaltBps_;
        highWaterPps = NAV_ONE;
        reportedAssets = 0;
        perfFeeBps = 1000; // 10% — matches the rate shown in the UI
        feeRecipient = admin; // production should point this at a treasury/multisig
        maxNavDeltaBps = 5000; // ±50% per-report guardrail on the keeper
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, keeper);
        _grantRole(AGENT_ROLE, agent);
    }

    /// @dev Shares carry 6 decimals to match USDC 1:1 at genesis NAV.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // -------------------------------------------------------------------
    //  NAV  (price per share, scaled 1e6)
    // -------------------------------------------------------------------
    function pricePerShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return NAV_ONE; // genesis: 1 share = 1 USDC
        // NAV value backing live shares = reportedAssets - liability already struck out
        uint256 backing = reportedAssets > pendingLiability ? reportedAssets - pendingLiability : 0;
        return (backing * NAV_ONE) / supply;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * NAV_ONE) / pricePerShare();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * pricePerShare()) / NAV_ONE;
    }

    // -------------------------------------------------------------------
    //  DEPOSIT  → mint shares at NAV   (settlement.js: strikeDeposit)
    // -------------------------------------------------------------------
    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (paused) revert VaultPaused();
        if (assets == 0) revert ZeroAmount();
        shares = convertToShares(assets);
        usdc.safeTransferFrom(msg.sender, address(this), assets);
        reportedAssets += assets; // cash now part of NAV
        _mint(receiver, shares);
        emit Deposited(receiver, assets, shares, pricePerShare());
    }

    // -------------------------------------------------------------------
    //  REDEEM  → burn at NAV, open 24h trade-close window
    //            (settlement.js: requestWithdrawal)
    // -------------------------------------------------------------------
    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroAmount();
        uint256 assets = convertToAssets(shares);
        _burn(msg.sender, shares); // shares gone now; value locked at this NAV
        pendingLiability += assets;

        id = withdrawals.length;
        withdrawals.push(
            Withdrawal({
                owner: msg.sender,
                assets: assets,
                closeDeadline: uint64(block.timestamp + TRADE_CLOSE),
                claimDeadline: 0,
                status: WStatus.Settling
            })
        );
        emit RedeemRequested(id, msg.sender, shares, assets);
    }

    /// @notice Agent (or anyone after the deadline) confirms liquidity is freed,
    ///         opening the 24h claim window.  (settlement.js: closeTrades)
    function closeTrades(uint256 id) external {
        Withdrawal storage w = withdrawals[id];
        if (w.status != WStatus.Settling) revert BadState();
        // before the deadline only the agent/keeper may close early; after, anyone
        if (block.timestamp < w.closeDeadline) {
            require(hasRole(AGENT_ROLE, msg.sender) || hasRole(KEEPER_ROLE, msg.sender), "only agent/keeper early");
        }
        w.status = WStatus.Claimable;
        w.claimDeadline = uint64(block.timestamp + CLAIM_DELAY);
        emit TradesClosed(id, w.claimDeadline);
    }

    /// @notice Depositor pulls their USDC once the claim window elapses.
    ///         (settlement.js: claim)
    function claim(uint256 id) external nonReentrant {
        Withdrawal storage w = withdrawals[id];
        if (w.status != WStatus.Claimable) revert BadState();
        if (block.timestamp < w.claimDeadline) revert WindowNotElapsed();
        uint256 assets = w.assets;
        w.status = WStatus.Settled;
        pendingLiability -= assets;
        reportedAssets = reportedAssets > assets ? reportedAssets - assets : 0;
        usdc.safeTransfer(w.owner, assets);
        emit Claimed(id, w.owner, assets);
    }

    // -------------------------------------------------------------------
    //  AGENT  — deploy/return capital to a WHITELISTED venue only.
    //  Cannot ever send to an EOA → non-custodial guarantee.
    // -------------------------------------------------------------------
    function allocate(address venue, uint256 assets) external onlyRole(AGENT_ROLE) nonReentrant {
        if (paused) revert VaultPaused();
        if (!allowedVenue[venue]) revert NotAllowedVenue();
        if (assets == 0) revert ZeroAmount();
        // NAV unchanged: funds leave the contract but remain counted in reportedAssets.
        usdc.safeTransfer(venue, assets);
        emit Allocated(venue, assets);
    }

    /// @notice Venue/agent returns capital to the vault (e.g. after unwinding).
    function returnFromVenue(uint256 assets) external nonReentrant {
        if (assets == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), assets);
        emit Returned(msg.sender, assets);
    }

    // -------------------------------------------------------------------
    //  KEEPER  — NAV reporting + settlement crank + circuit breaker
    // -------------------------------------------------------------------
    function reportNav(uint256 newReportedAssets) external onlyRole(KEEPER_ROLE) {
        _checkNavDelta(newReportedAssets);
        reportedAssets = newReportedAssets;
        uint256 pps = pricePerShare();
        if (pps > highWaterPps) {
            // Accrue the performance fee on the gain above the prior high, then
            // mark the (gross) new high so the same appreciation is never re-charged.
            _accruePerfFee(pps);
            highWaterPps = pps;
        }
        // Fee minting dilutes pps slightly; re-read for the circuit check + event.
        uint256 ppsAfter = pricePerShare();
        _checkCircuit(ppsAfter);
        emit NavReported(newReportedAssets, ppsAfter);
    }

    /// @dev Reject reports that move NAV more than `maxNavDeltaBps` from the
    ///      current baseline in a single epoch. No-op when disabled or at genesis.
    function _checkNavDelta(uint256 newAssets) internal view {
        uint256 cap = maxNavDeltaBps;
        if (cap == 0) return; // bound disabled
        uint256 base = reportedAssets;
        if (base == 0) return; // no baseline yet (pre-first-deposit/report)
        uint256 band = (base * cap) / 10_000;
        if (newAssets > base + band) revert NavDeltaTooLarge();
        if (newAssets + band < base) revert NavDeltaTooLarge(); // newAssets < base - band
    }

    /// @dev Mint fee shares worth `perfFeeBps` of the gain above the high-water
    ///      mark to `feeRecipient`. Caller guarantees `pps > highWaterPps`.
    function _accruePerfFee(uint256 pps) internal {
        uint256 supply = totalSupply();
        if (supply == 0 || perfFeeBps == 0 || feeRecipient == address(0)) return;
        uint256 gainPerShare = pps - highWaterPps; // > 0 by caller guard
        uint256 grossGain = (gainPerShare * supply) / NAV_ONE;
        uint256 feeAssets = (grossGain * perfFeeBps) / 10_000;
        if (feeAssets == 0) return;
        uint256 backing = reportedAssets > pendingLiability ? reportedAssets - pendingLiability : 0;
        if (feeAssets >= backing) return; // sanity guard (never reached in practice)
        // Shares that, at the current backing, are worth exactly `feeAssets`
        // post-mint. Identity: feeShares/(supply+feeShares) * backing == feeAssets.
        uint256 feeShares = (feeAssets * supply) / (backing - feeAssets);
        if (feeShares == 0) return;
        _mint(feeRecipient, feeShares);
        emit PerfFeeAccrued(feeRecipient, feeAssets, feeShares);
    }

    /// @notice Force-advance any settling withdrawals whose close deadline passed.
    ///         (settlement.js: tick)
    function crank(uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            Withdrawal storage w = withdrawals[ids[i]];
            if (w.status == WStatus.Settling && block.timestamp >= w.closeDeadline) {
                w.status = WStatus.Claimable;
                w.claimDeadline = uint64(block.timestamp + CLAIM_DELAY);
                emit TradesClosed(ids[i], w.claimDeadline);
            }
        }
    }

    /// @notice Σ shares × NAV must equal backing. (settlement.js: reconcile)
    function reconcile() external view returns (bool balanced, int256 diff) {
        uint256 implied = (totalSupply() * pricePerShare()) / NAV_ONE;
        uint256 backing = reportedAssets > pendingLiability ? reportedAssets - pendingLiability : 0;
        diff = int256(implied) - int256(backing);
        balanced = diff >= -1e4 && diff <= 1e4; // 0.01 USDC tolerance
    }

    function _checkCircuit(uint256 pps) internal {
        if (highWaterPps == 0) return;
        // drawdown in bps from high-water mark
        uint256 ddBps = pps >= highWaterPps ? 0 : ((highWaterPps - pps) * 10_000) / highWaterPps;
        if (ddBps >= ddHaltBps && !paused) {
            paused = true;
            emit CircuitTripped(ddBps);
            emit PausedSet(true);
        }
    }

    // -------------------------------------------------------------------
    //  GOVERNANCE  — venue allowlist + kill switch
    // -------------------------------------------------------------------
    function setVenue(address venue, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedVenue[venue] = allowed;
        emit VenueSet(venue, allowed);
    }

    /// @notice Set the performance fee (bps). Capped at MAX_PERF_FEE_BPS.
    function setPerfFee(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_PERF_FEE_BPS) revert FeeTooHigh();
        perfFeeBps = bps;
        emit PerfFeeSet(bps);
    }

    /// @notice Set the recipient of accrued performance-fee shares.
    function setFeeRecipient(address r) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeRecipient = r;
        emit FeeRecipientSet(r);
    }

    /// @notice Set the per-epoch NAV move bound (bps of current assets). 0 disables.
    function setMaxNavDelta(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxNavDeltaBps = bps;
        emit MaxNavDeltaSet(bps);
    }

    /// @notice Kill switch. Admin or keeper can halt; exits stay open.
    function setPaused(bool p) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(KEEPER_ROLE, msg.sender), "not authorized");
        paused = p;
        emit PausedSet(p);
    }

    function withdrawalsLength() external view returns (uint256) {
        return withdrawals.length;
    }
}
