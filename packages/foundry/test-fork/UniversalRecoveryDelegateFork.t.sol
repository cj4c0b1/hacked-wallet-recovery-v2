// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/UniversalRecoveryDelegate.sol";

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * Fork test that isolates the exact NFT move without any frontend/server code.
 *
 * It mimics EIP-7702 delegation by copying the deployed UniversalRecoveryDelegate runtime bytecode
 * onto the compromised EOA via `vm.etch`. This approximates the execution environment where
 * `address(this)` is the compromised EOA but the code/immutables are those of the delegate contract.
 *
 * Run:
 * - FORK_URL=http://127.0.0.1:8546 forge test test-fork -vvv --match-test testFork_MoveNftViaEtchedDelegation
 * - optionally: FORK_BLOCK_NUMBER=... (if you want a stable state)
 */
contract UniversalRecoveryDelegateForkTest is Test {
    address constant PAYMASTER = 0xBf9cb805a790213C2C649073D8863beC4913E442;
    address constant DELEGATE = 0x49222cc5273ddCFde0E2A7987d64F9D6D272967C;
    address payable constant COMPROMISED = payable(0x1c80D2A677c4a7756cf7D00fbb1c1766321333c3);
    address constant SAFE = 0x2F1ad369D2c81aD8620e47D80a28bF35faBcF030;

    address constant NFT = 0xdc67f98C8a57e1fb3D9dbf61b301622F7001D549;
    uint256 constant TOKEN_ID = 6934;

    // Local test signer for EIP-712 intents (represents your recovery operator / safe signer).
    uint256 constant INTENT_SIGNER_PK = 0xA11CE;

    function testFork_MoveNftViaEtchedDelegation() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) vm.skip(true, "FORK_URL not set (skipping fork tests)");
        uint256 blockNumber = vm.envOr("FORK_BLOCK_NUMBER", uint256(0));
        if (blockNumber != 0) vm.createSelectFork(url, blockNumber);
        else vm.createSelectFork(url);

        // Sanity check: the compromised address owns this token on the fork.
        assertEq(IERC721(NFT).ownerOf(TOKEN_ID), COMPROMISED, "unexpected initial owner");

        // Mimic EIP-7702 delegation: run delegate runtime code "as" the compromised address.
        bytes memory delegateRuntime = DELEGATE.code;
        assertGt(delegateRuntime.length, 0, "delegate has no code on fork");
        vm.etch(COMPROMISED, delegateRuntime);

        // Build the same ERC-721 transferFrom call we were attempting from the app.
        UniversalRecoveryDelegate.Call[] memory calls = new UniversalRecoveryDelegate.Call[](1);
        calls[0] = UniversalRecoveryDelegate.Call({
            to: NFT,
            value: 0,
            data: abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), COMPROMISED, SAFE, TOKEN_ID)
        });

        uint256 nonce = 0;
        uint256 deadline = 0; // no expiry for this test
        (bytes32 digest,) = UniversalRecoveryDelegate(COMPROMISED).recoveryIntentDigest(SAFE, calls, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(INTENT_SIGNER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        address authorizer = vm.addr(INTENT_SIGNER_PK);
        UniversalRecoveryDelegate(COMPROMISED).executeBatchRecovery(SAFE, calls, authorizer, nonce, deadline, sig);

        assertEq(IERC721(NFT).ownerOf(TOKEN_ID), SAFE, "owner did not change");
    }

    function testFork_RevertsIfInvalidSignature() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) vm.skip(true, "FORK_URL not set (skipping fork tests)");
        uint256 blockNumber = vm.envOr("FORK_BLOCK_NUMBER", uint256(0));
        if (blockNumber != 0) vm.createSelectFork(url, blockNumber);
        else vm.createSelectFork(url);

        bytes memory delegateRuntime = DELEGATE.code;
        assertGt(delegateRuntime.length, 0, "delegate has no code on fork");
        vm.etch(COMPROMISED, delegateRuntime);

        UniversalRecoveryDelegate.Call[] memory calls = new UniversalRecoveryDelegate.Call[](0);
        vm.expectRevert(UniversalRecoveryDelegate.InvalidSignature.selector);
        address authorizer = vm.addr(INTENT_SIGNER_PK);
        UniversalRecoveryDelegate(COMPROMISED).executeBatchRecovery(SAFE, calls, authorizer, 0, 0, "");
    }
}

