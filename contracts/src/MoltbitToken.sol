// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MoltbitToken
 * @notice An agent's launchpad token (Clanker-style: a token launched for an agent,
 *         whose trading/performance fees flow back to holders). This is a
 *         dividend-paying ERC20 — USDC fees deposited via `distributeFees` are split:
 *           creatorBps → the agent's creator (feeWallet)
 *           protocolBps → the Moltbit protocol
 *           remainder   → token HOLDERS, pro-rata, claimable any time.
 *
 *         Holder accounting uses the magnified-dividend-per-share pattern with
 *         transfer corrections in `_update`, so dividends stay correct across
 *         transfers. NEEDS `forge test` — not compiled in the build sandbox.
 */
contract MoltbitToken is ERC20 {
    using SafeERC20 for IERC20;

    uint256 internal constant MAGNITUDE = 2 ** 128;

    IERC20 public immutable usdc; // 6dp fee asset
    address public immutable creator; // agent creator (feeWallet)
    address public immutable protocol; // Moltbit treasury
    uint16 public immutable creatorBps; // share of fees to creator
    uint16 public immutable protocolBps; // share of fees to protocol
    string public agentId; // off-chain agent id this token represents

    uint256 internal magnifiedDividendPerShare;
    mapping(address => int256) internal magnifiedCorrections;
    mapping(address => uint256) internal withdrawnDividends;

    uint256 public totalFeesDistributed;

    event FeesDistributed(uint256 toHolders, uint256 toCreator, uint256 toProtocol);
    event DividendClaimed(address indexed account, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address holder_, // initial recipient of the full supply (factory → LP/creator)
        address usdc_,
        address creator_,
        address protocol_,
        uint16 creatorBps_,
        uint16 protocolBps_,
        string memory agentId_
    ) ERC20(name_, symbol_) {
        require(usdc_ != address(0) && creator_ != address(0) && protocol_ != address(0), "zero addr");
        require(creatorBps_ + protocolBps_ <= 10_000, "bps");
        usdc = IERC20(usdc_);
        creator = creator_;
        protocol = protocol_;
        creatorBps = creatorBps_;
        protocolBps = protocolBps_;
        agentId = agentId_;
        _mint(holder_, supply_);
    }

    /// @notice Deposit USDC fees; split to creator/protocol, rest to holders.
    function distributeFees(uint256 amount) external {
        require(amount > 0, "zero");
        require(totalSupply() > 0, "no supply");
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 toCreator = (amount * creatorBps) / 10_000;
        uint256 toProtocol = (amount * protocolBps) / 10_000;
        uint256 toHolders = amount - toCreator - toProtocol;

        if (toCreator > 0) usdc.safeTransfer(creator, toCreator);
        if (toProtocol > 0) usdc.safeTransfer(protocol, toProtocol);
        if (toHolders > 0) {
            magnifiedDividendPerShare += (toHolders * MAGNITUDE) / totalSupply();
        }
        totalFeesDistributed += amount;
        emit FeesDistributed(toHolders, toCreator, toProtocol);
    }

    /// @notice USDC a holder can currently claim.
    function withdrawableDividendOf(address account) public view returns (uint256) {
        return accumulativeDividendOf(account) - withdrawnDividends[account];
    }

    function accumulativeDividendOf(address account) public view returns (uint256) {
        int256 raw = int256(magnifiedDividendPerShare * balanceOf(account)) + magnifiedCorrections[account];
        return uint256(raw) / MAGNITUDE;
    }

    /// @notice Claim accrued USDC dividends.
    function claim() external {
        uint256 amount = withdrawableDividendOf(msg.sender);
        require(amount > 0, "nothing to claim");
        withdrawnDividends[msg.sender] += amount;
        usdc.safeTransfer(msg.sender, amount);
        emit DividendClaimed(msg.sender, amount);
    }

    /// @dev Keep dividend accounting correct across mint/burn/transfer.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        int256 magCorrection = int256(magnifiedDividendPerShare * value);
        if (from != address(0)) magnifiedCorrections[from] += magCorrection;
        if (to != address(0)) magnifiedCorrections[to] -= magCorrection;
    }
}
