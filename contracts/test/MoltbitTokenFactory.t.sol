// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MUSDC} from "./mocks/TestTokens.sol";
import {MoltbitTokenFactory} from "../src/MoltbitTokenFactory.sol";
import {MoltbitToken} from "../src/MoltbitToken.sol";

contract MoltbitTokenFactoryTest is Test {
    MUSDC usdc;
    MoltbitTokenFactory factory;
    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address recipient = makeAddr("recipient");

    function setUp() public {
        usdc = new MUSDC();
        factory = new MoltbitTokenFactory(address(usdc), protocol, address(this));
    }

    function test_launchCreatesAndRecordsToken() public {
        address t = factory.launch("agent-1", "Agent Token", "AGT", 1_000_000e18, creator, recipient);
        assertEq(factory.tokenOfAgent("agent-1"), t);
        assertEq(factory.tokensLength(), 1);
        MoltbitToken tok = MoltbitToken(t);
        assertEq(tok.balanceOf(recipient), 1_000_000e18);
        assertEq(tok.creator(), creator);
        assertEq(tok.creatorBps(), 4000);
        assertEq(tok.protocolBps(), 1000);
    }

    function test_duplicateAgentReverts() public {
        factory.launch("agent-1", "A", "A", 1e18, creator, recipient);
        vm.expectRevert(bytes("exists"));
        factory.launch("agent-1", "B", "B", 1e18, creator, recipient);
    }

    function test_onlyLauncherCanLaunch() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        factory.launch("agent-2", "A", "A", 1e18, creator, recipient);
    }
}
