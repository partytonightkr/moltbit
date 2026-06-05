// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MERC20} from "./mocks/TestTokens.sol";
import {MoltbitMiner} from "../src/MoltbitMiner.sol";

contract MoltbitMinerTest is Test {
    MERC20 stakeT;
    MERC20 rewardT;
    MERC20 gate;
    MoltbitMiner miner;
    address alice = makeAddr("alice");

    function setUp() public {
        stakeT = new MERC20("LP", "LP");
        rewardT = new MERC20("Reward", "RWD");
        gate = new MERC20("Gate", "GATE");
        miner = new MoltbitMiner(address(stakeT), address(rewardT), address(gate), 1e18, address(this));
        // fund emissions
        rewardT.mint(address(this), 1000e18);
        rewardT.approve(address(miner), 1000e18);
        miner.fundRewards(1000e18);
    }

    function test_gatedStakeRequiresGateToken() public {
        stakeT.mint(alice, 100e18);
        vm.startPrank(alice);
        stakeT.approve(address(miner), 100e18);
        vm.expectRevert(bytes("must hold gate token"));
        miner.stake(100e18);
        vm.stopPrank();
    }

    function test_stakeAccruesAndClaims() public {
        stakeT.mint(alice, 100e18);
        gate.mint(alice, 1e18); // satisfies the gate
        vm.startPrank(alice);
        stakeT.approve(address(miner), 100e18);
        miner.stake(100e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 10); // 10s * 1e18/s = 10e18 to the sole staker
        assertApproxEqAbs(miner.pending(alice), 10e18, 1e12);

        vm.prank(alice);
        miner.claim();
        assertApproxEqAbs(rewardT.balanceOf(alice), 10e18, 1e12);
    }

    function test_unstakeReturnsStakeAndHarvests() public {
        stakeT.mint(alice, 100e18);
        gate.mint(alice, 1e18);
        vm.startPrank(alice);
        stakeT.approve(address(miner), 100e18);
        miner.stake(100e18);
        vm.warp(block.timestamp + 5);
        miner.unstake(100e18);
        vm.stopPrank();
        assertEq(stakeT.balanceOf(alice), 100e18); // got the LP back
        assertApproxEqAbs(rewardT.balanceOf(alice), 5e18, 1e12); // harvested on unstake
    }
}
