// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MUSDC} from "./mocks/TestTokens.sol";
import {MoltbitToken} from "../src/MoltbitToken.sol";

contract MoltbitTokenTest is Test {
    MUSDC usdc;
    MoltbitToken tok;

    address creator = makeAddr("creator");
    address protocol = makeAddr("protocol");
    address feePayer = makeAddr("feePayer");
    address bob = makeAddr("bob");
    uint256 constant SUPPLY = 1_000_000e18;

    // address(this) is the initial holder of the full supply
    function setUp() public {
        usdc = new MUSDC();
        tok = new MoltbitToken("Agent Token", "AGT", SUPPLY, address(this), address(usdc), creator, protocol, 4000, 1000, "agent-1");
    }

    function _distribute(uint256 amt) internal {
        usdc.mint(feePayer, amt);
        vm.startPrank(feePayer);
        usdc.approve(address(tok), amt);
        tok.distributeFees(amt);
        vm.stopPrank();
    }

    function test_supplyMintedToHolder() public view {
        assertEq(tok.totalSupply(), SUPPLY);
        assertEq(tok.balanceOf(address(this)), SUPPLY);
    }

    function test_feeSplit_creatorProtocolHolders() public {
        _distribute(1000e6);
        assertEq(usdc.balanceOf(creator), 400e6); // 40%
        assertEq(usdc.balanceOf(protocol), 100e6); // 10%
        // remaining 50% accrues to the sole holder
        assertApproxEqAbs(tok.withdrawableDividendOf(address(this)), 500e6, 1e6);

        uint256 before = usdc.balanceOf(address(this));
        tok.claim();
        assertApproxEqAbs(usdc.balanceOf(address(this)) - before, 500e6, 1e6);
        assertEq(tok.withdrawableDividendOf(address(this)), 0);
    }

    function test_proRataWhenSplitBeforeDistribute() public {
        tok.transfer(bob, SUPPLY / 2);
        _distribute(1000e6);
        assertApproxEqAbs(tok.withdrawableDividendOf(address(this)), 250e6, 1e6);
        assertApproxEqAbs(tok.withdrawableDividendOf(bob), 250e6, 1e6);
    }

    function test_pastDividendsStayWithSenderOnTransfer() public {
        _distribute(1000e6); // holder owns all → accrues 500e6
        tok.transfer(bob, SUPPLY / 2);
        assertApproxEqAbs(tok.withdrawableDividendOf(address(this)), 500e6, 1e6);
        assertApproxEqAbs(tok.withdrawableDividendOf(bob), 0, 1e6);
    }

    function test_claimRevertsWhenNothing() public {
        vm.prank(bob);
        vm.expectRevert(bytes("nothing to claim"));
        tok.claim();
    }
}
