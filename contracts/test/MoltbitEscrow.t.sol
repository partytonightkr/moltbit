// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MUSDC} from "./mocks/TestTokens.sol";
import {MoltbitEscrow} from "../src/MoltbitEscrow.sol";

contract MoltbitEscrowTest is Test {
    MUSDC usdc;
    MoltbitEscrow escrow;
    address treasury = makeAddr("treasury");
    address deployer = makeAddr("deployer");
    bytes32 constant AGENT = keccak256("agent-1");

    function setUp() public {
        usdc = new MUSDC();
        escrow = new MoltbitEscrow(address(usdc), treasury, address(this));
    }

    function _fund(uint64 ratePerSec, uint256 amount) internal {
        usdc.mint(deployer, amount);
        vm.startPrank(deployer);
        usdc.approve(address(escrow), amount);
        escrow.fund(AGENT, ratePerSec, amount);
        vm.stopPrank();
    }

    function test_fundThenStreamReducesRunway() public {
        _fund(1e6, 100e6); // 1 USDC/sec, 100 USDC escrow
        assertEq(escrow.remaining(AGENT), 100e6);
        assertTrue(escrow.hasRunway(AGENT));

        vm.warp(block.timestamp + 10);
        assertEq(escrow.remaining(AGENT), 90e6);
        assertEq(escrow.runwaySeconds(AGENT), 90);

        vm.warp(block.timestamp + 1000); // fully drained
        assertEq(escrow.remaining(AGENT), 0);
        assertFalse(escrow.hasRunway(AGENT));
    }

    function test_retireRefundsUnspentAndStreamsRest() public {
        _fund(1e6, 100e6);
        vm.warp(block.timestamp + 10); // 10 streamed, 90 remaining

        uint256 before = usdc.balanceOf(deployer);
        vm.prank(deployer);
        escrow.retire(AGENT);
        assertEq(usdc.balanceOf(deployer) - before, 90e6); // refund
        assertEq(escrow.streamedToTreasury(), 10e6);
        assertFalse(escrow.hasRunway(AGENT));
    }

    function test_treasuryCollectsStreamed() public {
        _fund(1e6, 100e6);
        vm.warp(block.timestamp + 10);
        escrow.settle(AGENT); // realize the 10 streamed
        escrow.collect(10e6); // admin has TREASURER_ROLE
        assertEq(usdc.balanceOf(treasury), 10e6);
        assertEq(escrow.streamedToTreasury(), 0);
    }

    function test_onlyDeployerRetires() public {
        _fund(1e6, 100e6);
        vm.expectRevert(bytes("not deployer"));
        escrow.retire(AGENT); // address(this) is not the deployer
    }
}
