// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KinfolioSplitter} from "../src/KinfolioSplitter.sol";

contract Refuses {
    receive() external payable {
        revert("no");
    }
}

contract KinfolioSplitterTest is Test {
    KinfolioSplitter splitter;
    address a = address(0xA11CE);
    address b = address(0xB0B);

    function setUp() public {
        splitter = new KinfolioSplitter();
    }

    function heirs(address x, address y) internal pure returns (address[] memory to) {
        to = new address[](2);
        to[0] = x;
        to[1] = y;
    }

    function shares(uint16 x, uint16 y) internal pure returns (uint16[] memory bps) {
        bps = new uint16[](2);
        bps[0] = x;
        bps[1] = y;
    }

    function test_splits_sixty_forty() public {
        splitter.split{value: 1 ether}(heirs(a, b), shares(6_000, 4_000));
        assertEq(a.balance, 0.6 ether);
        assertEq(b.balance, 0.4 ether);
        assertEq(address(splitter).balance, 0);
    }

    function test_last_heir_takes_rounding_remainder() public {
        splitter.split{value: 7 wei}(heirs(a, b), shares(3_333, 6_667));
        assertEq(a.balance + b.balance, 7);
        assertEq(address(splitter).balance, 0);
    }

    function testFuzz_never_keeps_funds(uint96 value, uint16 x) public {
        x = uint16(bound(x, 1, 9_999));
        vm.deal(address(this), value);
        splitter.split{value: value}(heirs(a, b), shares(x, 10_000 - x));
        assertEq(a.balance + b.balance, value);
        assertEq(address(splitter).balance, 0);
    }

    function test_reverts_when_shares_do_not_total_10000() public {
        vm.expectRevert(KinfolioSplitter.BadShares.selector);
        splitter.split{value: 1 ether}(heirs(a, b), shares(6_000, 3_000));
    }

    function test_reverts_on_length_mismatch() public {
        uint16[] memory one = new uint16[](1);
        one[0] = 10_000;
        vm.expectRevert(KinfolioSplitter.LengthMismatch.selector);
        splitter.split{value: 1 ether}(heirs(a, b), one);
    }

    function test_reverts_whole_split_if_one_heir_refuses() public {
        address r = address(new Refuses());
        vm.expectRevert(abi.encodeWithSelector(KinfolioSplitter.TransferFailed.selector, r));
        splitter.split{value: 1 ether}(heirs(a, r), shares(5_000, 5_000));
    }
}
