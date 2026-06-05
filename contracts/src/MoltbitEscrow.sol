// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltbitEscrow
 * @notice Compulsory maintenance escrow for LIVE agents. A deployer locks USDC
 *         (~1 year of running cost); it STREAMS to the treasury at a fixed run
 *         rate. While runway remains the agent is `live`; when the escrow is
 *         exhausted `hasRunway()` returns false and the keeper/gateway pauses the
 *         agent until it is topped up. The unspent remainder is refundable when
 *         the deployer retires the agent.
 *
 *         On-chain expression of `lib/economics.js` + `DEPLOYMENT.md`:
 *           fund   → escrow up, runway up
 *           stream → treasury accrues at ratePerSec
 *           pause  → automatic at zero runway (read by the keeper)
 *           refund → remaining (unstreamed) returned on retire
 */
contract MoltbitEscrow is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    IERC20 public immutable usdc; // 6dp
    address public treasury; // where streamed maintenance fees accrue

    struct Account {
        address deployer; // who funds + can top up / retire
        uint128 balance; // USDC (6dp) currently escrowed (not yet streamed)
        uint64 ratePerSec; // USDC (6dp) streamed per second
        uint64 lastTick; // last time the stream was settled
        bool retired;
    }

    // agentId (keccak of the off-chain agent.id) → account
    mapping(bytes32 => Account) public accounts;
    uint256 public streamedToTreasury; // lifetime streamed, claimable by treasury

    event Funded(bytes32 indexed agentId, address indexed deployer, uint256 amount, uint64 ratePerSec);
    event Streamed(bytes32 indexed agentId, uint256 amount);
    event Refunded(bytes32 indexed agentId, address indexed to, uint256 amount);
    event Retired(bytes32 indexed agentId);
    event TreasurySet(address treasury);

    constructor(address _usdc, address _treasury, address admin) {
        require(_usdc != address(0) && _treasury != address(0) && admin != address(0), "zero addr");
        usdc = IERC20(_usdc);
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);
    }

    // ---- funding ----------------------------------------------------------

    /// @notice Lock escrow for an agent. `ratePerSec` is the maintenance run rate
    ///         (from lib/economics.js: monthlyCostUsd/30/86400, in 6dp USDC).
    function fund(bytes32 agentId, uint64 ratePerSec, uint256 amount) external nonReentrant {
        require(amount > 0 && ratePerSec > 0, "bad args");
        Account storage a = accounts[agentId];
        require(!a.retired, "retired");
        _settle(agentId); // bring the stream current before changing balance

        if (a.deployer == address(0)) {
            a.deployer = msg.sender;
            a.lastTick = uint64(block.timestamp);
        } else {
            require(a.deployer == msg.sender, "not deployer");
        }
        a.ratePerSec = ratePerSec;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        a.balance += uint128(amount);
        emit Funded(agentId, msg.sender, amount, ratePerSec);
    }

    // ---- streaming --------------------------------------------------------

    /// @notice Settle the stream: move elapsed maintenance from escrow → treasury bucket.
    function _settle(bytes32 agentId) internal {
        Account storage a = accounts[agentId];
        if (a.deployer == address(0) || a.balance == 0) {
            a.lastTick = uint64(block.timestamp);
            return;
        }
        uint256 elapsed = block.timestamp - a.lastTick;
        if (elapsed == 0) return;
        uint256 owed = elapsed * a.ratePerSec;
        if (owed > a.balance) owed = a.balance; // can't stream more than escrowed
        a.balance -= uint128(owed);
        streamedToTreasury += owed;
        a.lastTick = uint64(block.timestamp);
        if (owed > 0) emit Streamed(agentId, owed);
    }

    /// @notice Public poke so anyone (the keeper) can settle a stream.
    function settle(bytes32 agentId) external {
        _settle(agentId);
    }

    // ---- views ------------------------------------------------------------

    /// @notice Remaining escrow after settling the stream up to now (view).
    function remaining(bytes32 agentId) public view returns (uint256) {
        Account memory a = accounts[agentId];
        if (a.deployer == address(0)) return 0;
        uint256 owed = (block.timestamp - a.lastTick) * a.ratePerSec;
        return owed >= a.balance ? 0 : a.balance - owed;
    }

    /// @notice The funding gate the keeper/gateway reads (mirror of economics.hasRunway).
    function hasRunway(bytes32 agentId) external view returns (bool) {
        return remaining(agentId) > 0 && !accounts[agentId].retired;
    }

    function runwaySeconds(bytes32 agentId) external view returns (uint256) {
        Account memory a = accounts[agentId];
        if (a.ratePerSec == 0) return 0;
        return remaining(agentId) / a.ratePerSec;
    }

    // ---- exit -------------------------------------------------------------

    /// @notice Retire the agent and refund the unspent escrow to the deployer.
    function retire(bytes32 agentId) external nonReentrant {
        Account storage a = accounts[agentId];
        require(a.deployer == msg.sender, "not deployer");
        require(!a.retired, "retired");
        _settle(agentId);
        uint256 refund = a.balance;
        a.balance = 0;
        a.retired = true;
        if (refund > 0) usdc.safeTransfer(msg.sender, refund);
        emit Refunded(agentId, msg.sender, refund);
        emit Retired(agentId);
    }

    // ---- treasury ---------------------------------------------------------

    /// @notice Treasury withdraws streamed maintenance fees.
    function collect(uint256 amount) external onlyRole(TREASURER_ROLE) nonReentrant {
        require(amount <= streamedToTreasury, "exceeds streamed");
        streamedToTreasury -= amount;
        usdc.safeTransfer(treasury, amount);
    }

    function setTreasury(address t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(t != address(0), "zero addr");
        treasury = t;
        emit TreasurySet(t);
    }
}
