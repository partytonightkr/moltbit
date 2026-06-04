// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MoltbitVaultFactory} from "../src/MoltbitVaultFactory.sol";

/**
 * Deploy the factory, then one vault for a sample strategy.
 *
 *   # Base Sepolia (testnet USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e)
 *   forge script script/Deploy.s.sol \
 *     --rpc-url base_sepolia --broadcast --verify \
 *     --sig "run(address,address,address)" \
 *     <USDC> <ADMIN> <KEEPER>
 */
contract Deploy is Script {
    // USDC per chain
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run(address usdc, address admin, address keeper) external {
        vm.startBroadcast();
        MoltbitVaultFactory factory = new MoltbitVaultFactory(usdc, admin, keeper);
        console2.log("Factory:", address(factory));

        // sample vault — agent is the deployer for the demo; swap for the real scoped key
        address vault = factory.createVault(
            keccak256("funding-harvest-v3"),
            "Moltbit Funding Harvest v3",
            "mFNDH3",
            msg.sender,
            2000 // -20% drawdown halt
        );
        console2.log("Sample vault:", vault);
        vm.stopBroadcast();
    }
}
