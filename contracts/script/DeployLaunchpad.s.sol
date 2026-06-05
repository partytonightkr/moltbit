// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MoltbitTokenFactory} from "../src/MoltbitTokenFactory.sol";
import {MoltbitBetPool} from "../src/MoltbitBetPool.sol";
import {MoltbitEscrow} from "../src/MoltbitEscrow.sol";

/**
 * Deploy the Launchpad singletons: token factory (Clanker-style launches), the
 * parimutuel bet pool, and the maintenance escrow. Per-agent contracts
 * (MoltbitToken, MoltbitMiner) are deployed later — the token via the factory on
 * launch, a miner per pool when mining opens.
 *
 *   forge script script/DeployLaunchpad.s.sol \
 *     --rpc-url base_sepolia --broadcast --verify \
 *     --sig "run(address,address,address)" \
 *     <USDC> <TREASURY> <ADMIN>
 *
 * LP bootstrap (seed + lock a Uniswap v3/v4 pool for a launched token) is
 * network-specific (position-manager / router addresses) and is done in a
 * follow-up step once `UNISWAP_POSITION_MANAGER` is known — see LAUNCHPAD.md.
 */
contract DeployLaunchpad is Script {
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run(address usdc, address treasury, address admin) external {
        vm.startBroadcast();

        MoltbitTokenFactory tokenFactory = new MoltbitTokenFactory(usdc, treasury, admin);
        console2.log("MoltbitTokenFactory:", address(tokenFactory));

        MoltbitBetPool betPool = new MoltbitBetPool(usdc, treasury, admin);
        console2.log("MoltbitBetPool:", address(betPool));

        MoltbitEscrow escrow = new MoltbitEscrow(usdc, treasury, admin);
        console2.log("MoltbitEscrow:", address(escrow));

        vm.stopBroadcast();
    }
}
