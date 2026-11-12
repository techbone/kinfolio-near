// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {KinfolioSplitter} from "../src/KinfolioSplitter.sol";

contract Deploy is Script {
    function run() external returns (KinfolioSplitter splitter) {
        vm.startBroadcast();
        splitter = new KinfolioSplitter();
        vm.stopBroadcast();
    }
}
