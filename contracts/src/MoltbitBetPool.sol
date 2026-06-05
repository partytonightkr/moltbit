// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltbitBetPool
 * @notice Parimutuel outperformance markets for the Launchpad. Bettors stake USDC
 *         on YES/NO ("will this agent beat the 30d median?"); the winning side
 *         splits the whole pool pro-rata, minus a protocol fee. The ORACLE_ROLE
 *         (Moltbit, settling from the agent's recorded performance) resolves.
 *
 *         On-chain expression of `lib/routes/markets.js`. NEEDS `forge test` —
 *         not compiled in the build sandbox.
 */
contract MoltbitBetPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IERC20 public immutable usdc; // 6dp
    address public treasury;
    uint16 public feeBps = 300; // 3%

    enum Status { Open, Resolved }
    enum Side { No, Yes }

    struct Market {
        bytes32 agentId;
        uint128 yes;
        uint128 no;
        Status status;
        Side outcome;
        uint64 createdAt;
    }

    Market[] public markets;
    // marketId → bettor → side → staked
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public staked;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketOpened(uint256 indexed id, bytes32 indexed agentId);
    event Bet(uint256 indexed id, address indexed who, Side side, uint256 amount);
    event Resolved(uint256 indexed id, Side outcome, uint256 pool);
    event Claimed(uint256 indexed id, address indexed who, uint256 payout);

    constructor(address _usdc, address _treasury, address admin) {
        require(_usdc != address(0) && _treasury != address(0) && admin != address(0), "zero addr");
        usdc = IERC20(_usdc);
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
    }

    function open(bytes32 agentId) external onlyRole(ORACLE_ROLE) returns (uint256 id) {
        id = markets.length;
        markets.push(Market({ agentId: agentId, yes: 0, no: 0, status: Status.Open, outcome: Side.No, createdAt: uint64(block.timestamp) }));
        emit MarketOpened(id, agentId);
    }

    function bet(uint256 id, Side side, uint256 amount) external nonReentrant {
        Market storage m = markets[id];
        require(m.status == Status.Open, "closed");
        require(amount > 0, "zero");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        staked[id][msg.sender][uint8(side)] += amount;
        if (side == Side.Yes) m.yes += uint128(amount); else m.no += uint128(amount);
        emit Bet(id, msg.sender, side, amount);
    }

    function resolve(uint256 id, Side outcome) external onlyRole(ORACLE_ROLE) {
        Market storage m = markets[id];
        require(m.status == Status.Open, "resolved");
        m.status = Status.Resolved;
        m.outcome = outcome;
        uint256 pool = uint256(m.yes) + m.no;
        uint256 fee = (pool * feeBps) / 10_000;
        if (fee > 0) usdc.safeTransfer(treasury, fee);
        emit Resolved(id, outcome, pool);
    }

    /// @notice Claim winnings: your winning stake × (net pool / winning pool).
    function claim(uint256 id) external nonReentrant {
        Market storage m = markets[id];
        require(m.status == Status.Resolved, "open");
        require(!claimed[id][msg.sender], "claimed");
        uint256 mine = staked[id][msg.sender][uint8(m.outcome)];
        require(mine > 0, "no winnings");
        uint256 pool = uint256(m.yes) + m.no;
        uint256 net = pool - (pool * feeBps) / 10_000;
        uint256 winners = m.outcome == Side.Yes ? m.yes : m.no;
        uint256 payout = (mine * net) / winners;
        claimed[id][msg.sender] = true;
        usdc.safeTransfer(msg.sender, payout);
        emit Claimed(id, msg.sender, payout);
    }

    function marketsLength() external view returns (uint256) {
        return markets.length;
    }

    function setFee(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 1000, "too high");
        feeBps = bps;
    }
}
