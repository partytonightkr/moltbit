// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MoltbitToken} from "./MoltbitToken.sol";

/**
 * @title MoltbitTokenFactory
 * @notice Launches an agent's token (Clanker-style: one call deploys the token and
 *         records it). Fee splits (holders / creator / protocol) live in the token.
 *
 *         LP bootstrap (seed a Uniswap v3/v4 pool with part of supply + base asset
 *         and lock it) is network-specific (router/position-manager addresses), so it
 *         is intentionally left to the deploy script / a pluggable `lpModule` rather
 *         than hardcoded here — keeps this contract chain-agnostic and testable.
 *         NEEDS `forge test` — not compiled in the build sandbox.
 */
contract MoltbitTokenFactory is AccessControl {
    bytes32 public constant LAUNCHER_ROLE = keccak256("LAUNCHER_ROLE");

    address public immutable usdc;
    address public protocol; // Moltbit treasury (default fee recipient)
    uint16 public defaultCreatorBps = 4000; // 40% of fees → creator
    uint16 public defaultProtocolBps = 1000; // 10% → protocol; remaining 50% → holders

    address[] public allTokens;
    mapping(string => address) public tokenOfAgent; // agentId → token

    event TokenLaunched(string agentId, address indexed token, address indexed creator, uint256 supply);
    event DefaultsSet(uint16 creatorBps, uint16 protocolBps);

    constructor(address _usdc, address _protocol, address admin) {
        require(_usdc != address(0) && _protocol != address(0) && admin != address(0), "zero addr");
        usdc = _usdc;
        protocol = _protocol;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(LAUNCHER_ROLE, admin);
    }

    function launch(
        string calldata agentId,
        string calldata name,
        string calldata symbol,
        uint256 supply,
        address creator,
        address supplyRecipient // who receives the supply to seed LP / distribute
    ) external onlyRole(LAUNCHER_ROLE) returns (address token) {
        require(tokenOfAgent[agentId] == address(0), "exists");
        require(creator != address(0) && supplyRecipient != address(0), "zero addr");

        token = address(new MoltbitToken(
            name, symbol, supply, supplyRecipient,
            usdc, creator, protocol, defaultCreatorBps, defaultProtocolBps, agentId
        ));

        tokenOfAgent[agentId] = token;
        allTokens.push(token);
        emit TokenLaunched(agentId, token, creator, supply);
    }

    function tokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function setDefaults(uint16 creatorBps, uint16 protocolBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(creatorBps + protocolBps <= 10_000, "bps");
        defaultCreatorBps = creatorBps;
        defaultProtocolBps = protocolBps;
        emit DefaultsSet(creatorBps, protocolBps);
    }

    function setProtocol(address p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p != address(0), "zero addr");
        protocol = p;
    }
}
