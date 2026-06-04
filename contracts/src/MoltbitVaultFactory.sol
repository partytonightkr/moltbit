// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MoltbitVault} from "./MoltbitVault.sol";

/**
 * @title MoltbitVaultFactory
 * @notice Deploys one MoltbitVault per strategy and indexes them by a
 *         bytes32 strategy id (keccak of the off-chain strategy slug, e.g.
 *         keccak256("funding-harvest-v3")). The frontend's `vaultAddressFor`
 *         resolves a strategy to its vault through `vaultOf`.
 *
 * @dev    ⚠️ UNAUDITED REFERENCE. Audit + legal sign-off before mainnet.
 */
contract MoltbitVaultFactory {
    address public immutable usdc;
    address public admin; // governance (multisig in production)
    address public keeper; // settlement/NAV crank

    mapping(bytes32 => address) public vaultOf; // strategyId => vault
    address[] public allVaults;

    event VaultCreated(bytes32 indexed strategyId, address vault, address agent);
    event AdminChanged(address admin);
    event KeeperChanged(address keeper);

    error AlreadyExists();
    error NotAdmin();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address usdc_, address admin_, address keeper_) {
        usdc = usdc_;
        admin = admin_;
        keeper = keeper_;
    }

    /**
     * @param strategyId keccak256 of the strategy slug
     * @param name       ERC20 share name  (e.g. "Moltbit Funding Harvest v3")
     * @param symbol     ERC20 share symbol (e.g. "mFNDH3")
     * @param agent      the strategy's scoped agent (AGENT_ROLE — trade only)
     * @param ddHaltBps  drawdown halt threshold, basis points (e.g. 2000 = -20%)
     */
    function createVault(
        bytes32 strategyId,
        string calldata name,
        string calldata symbol,
        address agent,
        uint256 ddHaltBps
    ) external onlyAdmin returns (address vault) {
        if (vaultOf[strategyId] != address(0)) revert AlreadyExists();
        vault = address(new MoltbitVault(name, symbol, usdc, ddHaltBps, admin, keeper, agent));
        vaultOf[strategyId] = vault;
        allVaults.push(vault);
        emit VaultCreated(strategyId, vault, agent);
    }

    function vaultsLength() external view returns (uint256) {
        return allVaults.length;
    }

    function setAdmin(address a) external onlyAdmin {
        admin = a;
        emit AdminChanged(a);
    }

    function setKeeper(address k) external onlyAdmin {
        keeper = k;
        emit KeeperChanged(k);
    }
}
