// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltbitMiner
 * @notice Token-gated liquidity mining for the Launchpad "Mine" action. Stake the
 *         agent's LP (or token) to earn the reward token, streamed at `rewardPerSec`
 *         via MasterChef-style `accRewardPerShare`. Entry is GATED: a staker must
 *         hold the agent's `gateToken` (surfaced in the UI as "you must hold $TOKEN
 *         to deposit"). NEEDS `forge test` — not compiled in the build sandbox.
 */
contract MoltbitMiner is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    uint256 internal constant ACC = 1e12;

    IERC20 public immutable stakeToken; // LP or agent token staked
    IERC20 public immutable rewardToken; // emissions
    IERC20 public immutable gateToken; // must hold > 0 to participate
    uint256 public rewardPerSec;

    uint256 public totalStaked;
    uint256 public accRewardPerShare;
    uint256 public lastReward;
    uint256 public rewardReserve; // funded emissions available to pay out

    struct User { uint256 amount; uint256 debt; }
    mapping(address => User) public users;

    event Staked(address indexed who, uint256 amount);
    event Unstaked(address indexed who, uint256 amount);
    event Claimed(address indexed who, uint256 reward);

    constructor(address _stake, address _reward, address _gate, uint256 _rewardPerSec, address admin) {
        require(_stake != address(0) && _reward != address(0) && _gate != address(0) && admin != address(0), "zero addr");
        stakeToken = IERC20(_stake);
        rewardToken = IERC20(_reward);
        gateToken = IERC20(_gate);
        rewardPerSec = _rewardPerSec;
        lastReward = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FUNDER_ROLE, admin);
    }

    function _update() internal {
        if (block.timestamp <= lastReward) return;
        if (totalStaked > 0 && rewardPerSec > 0) {
            uint256 pending = (block.timestamp - lastReward) * rewardPerSec;
            if (pending > rewardReserve) pending = rewardReserve; // never owe more than funded
            rewardReserve -= pending;
            accRewardPerShare += (pending * ACC) / totalStaked;
        }
        lastReward = block.timestamp;
    }

    function fundRewards(uint256 amount) external onlyRole(FUNDER_ROLE) {
        _update();
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;
    }

    function pending(address who) external view returns (uint256) {
        uint256 acc = accRewardPerShare;
        if (block.timestamp > lastReward && totalStaked > 0 && rewardPerSec > 0) {
            uint256 p = (block.timestamp - lastReward) * rewardPerSec;
            if (p > rewardReserve) p = rewardReserve;
            acc += (p * ACC) / totalStaked;
        }
        User memory u = users[who];
        return (u.amount * acc) / ACC - u.debt;
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        require(gateToken.balanceOf(msg.sender) > 0, "must hold gate token");
        _update();
        User storage u = users[msg.sender];
        _harvest(u);
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        u.amount += amount;
        totalStaked += amount;
        u.debt = (u.amount * accRewardPerShare) / ACC;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        User storage u = users[msg.sender];
        require(amount > 0 && u.amount >= amount, "bad amount");
        _update();
        _harvest(u);
        u.amount -= amount;
        totalStaked -= amount;
        u.debt = (u.amount * accRewardPerShare) / ACC;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claim() external nonReentrant {
        _update();
        User storage u = users[msg.sender];
        _harvest(u);
        u.debt = (u.amount * accRewardPerShare) / ACC;
    }

    function _harvest(User storage u) internal {
        if (u.amount == 0) return;
        uint256 owed = (u.amount * accRewardPerShare) / ACC - u.debt;
        if (owed > 0) {
            rewardToken.safeTransfer(msg.sender, owed);
            emit Claimed(msg.sender, owed);
        }
    }

    function setRewardPerSec(uint256 r) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _update();
        rewardPerSec = r;
    }
}
