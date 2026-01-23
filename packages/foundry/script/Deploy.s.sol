//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/UniversalRecoveryDelegate.sol";
import "../contracts/TestMintERC20.sol";
import "../contracts/TestMintERC721.sol";

/**
 * @notice Main deployment script for all contracts
 * @dev Run this when you want to deploy multiple contracts at once
 *
 * Example: yarn deploy # runs this script(without`--file` flag)
 */
contract DeployScript is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Deploys all contracts sequentially (simple CREATE, no CREATE2).

        // Configure the paymaster allowed to execute recoveries.
        // For local dev, set PAYMASTER_ADDRESS to match the server's PAYMASTER_PRIVATE_KEY address.
        address pm = vm.envOr("PAYMASTER_ADDRESS", deployer);
        UniversalRecoveryDelegate universalRecoveryDelegate = new UniversalRecoveryDelegate(pm);
        deployments.push(Deployment("UniversalRecoveryDelegate", address(universalRecoveryDelegate)));

        // Local testing helpers for seeding balances / NFTs on Anvil.
        TestMintERC20 testMintErc20 = new TestMintERC20("Test Mint ERC20", "TME20");
        deployments.push(Deployment("TestMintERC20", address(testMintErc20)));

        TestMintERC721 testMintErc721 = new TestMintERC721("Test Mint ERC721", "TME721");
        deployments.push(Deployment("TestMintERC721", address(testMintErc721)));
    }
}

