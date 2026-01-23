// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/UniversalRecoveryDelegate.sol";

/**
 * @notice Deploy script for UniversalRecoveryDelegate contract
 * @dev Uses ScaffoldEthDeployerRunner to export ABIs & addresses to `packages/nextjs/contracts`.
 */
contract DeployUniversalRecoveryDelegate is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Simple CREATE deployment (no CREATE2).
        // Configure the paymaster allowed to execute recoveries.
        // For local dev, set PAYMASTER_ADDRESS to match the server's PAYMASTER_PRIVATE_KEY address.
        address pm = vm.envOr("PAYMASTER_ADDRESS", deployer);
        UniversalRecoveryDelegate deployed = new UniversalRecoveryDelegate(pm);
        console.log("Deployed UniversalRecoveryDelegate at:", address(deployed));
        console.log("Paymaster:", pm);
        deployments.push(Deployment("UniversalRecoveryDelegate", address(deployed)));
    }
}

