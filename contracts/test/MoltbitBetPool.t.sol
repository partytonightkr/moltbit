// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MUSDC} from "./mocks/TestTokens.sol";
import {MoltbitBetPool} from "../src/MoltbitBetPool.sol";

contract MoltbitBetPoolTest is Test {
    MUSDC usdc;
    MoltbitBetPool pool;
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        usdc = new MUSDC();
        pool = new MoltbitBetPool(address(usdc), treasury, address(this));
    }

    function _bet(address who, uint256 id, MoltbitBetPool.Side side, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(pool), amt);
        pool.bet(id, side, amt);
        vm.stopPrank();
    }

    function test_parimutuelLifecycleAndPayout() public {
        uint256 id = pool.open(keccak256("agent-1"));
        _bet(alice, id, MoltbitBetPool.Side.Yes, 300e6);
        _bet(bob, id, MoltbitBetPool.Side.No, 100e6);

        pool.resolve(id, MoltbitBetPool.Side.Yes);
        // 3% fee on the 400 pool → 12 to treasury
        assertEq(usdc.balanceOf(treasury), 12e6);

        // alice (winner) claims net pool: 300 * 388/300 = 388
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.claim(id);
        assertEq(usdc.balanceOf(alice) - before, 388e6);

        // bob (loser) has no winnings
        vm.prank(bob);
        vm.expectRevert(bytes("no winnings"));
        pool.claim(id);
    }

    function test_doubleClaimReverts() public {
        uint256 id = pool.open(keccak256("agent-1"));
        _bet(alice, id, MoltbitBetPool.Side.Yes, 100e6);
        pool.resolve(id, MoltbitBetPool.Side.Yes);
        vm.startPrank(alice);
        pool.claim(id);
        vm.expectRevert(bytes("claimed"));
        pool.claim(id);
        vm.stopPrank();
    }

    function test_betOnClosedReverts() public {
        uint256 id = pool.open(keccak256("agent-1"));
        pool.resolve(id, MoltbitBetPool.Side.No);
        usdc.mint(alice, 10e6);
        vm.startPrank(alice);
        usdc.approve(address(pool), 10e6);
        vm.expectRevert(bytes("closed"));
        pool.bet(id, MoltbitBetPool.Side.Yes, 10e6);
        vm.stopPrank();
    }

    function test_onlyOracleResolves() public {
        uint256 id = pool.open(keccak256("agent-1"));
        vm.prank(alice);
        vm.expectRevert();
        pool.resolve(id, MoltbitBetPool.Side.Yes);
    }
}
