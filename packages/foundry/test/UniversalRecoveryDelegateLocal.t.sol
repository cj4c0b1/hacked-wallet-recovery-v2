// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/UniversalRecoveryDelegate.sol";
import "../contracts/TestMintERC20.sol";
import "../contracts/TestMintERC721.sol";

/**
 * Local test (no fork/RPC required).
 *
 * It simulates ERC-7702 delegation by copying the deployed UniversalRecoveryDelegate runtime bytecode
 * onto a "compromised" EOA via `vm.etch`. This approximates the delegated execution environment where
 * `address(this)` is the compromised EOA, while the code is the delegate implementation.
 */
contract UniversalRecoveryDelegateLocalTest is Test {
    // Represents your operator / intent signer (offchain).
    uint256 constant INTENT_SIGNER_PK = 0xA11CE;

    // Simulated compromised wallet (EOA) and safe destination.
    address payable compromised;
    address safe;

    UniversalRecoveryDelegate delegateImpl;
    TestMintERC721 nft;
    TestMintERC20 erc20;
    address authorizer;

    function setUp() public {
        compromised = payable(vm.addr(0xC0FFEE));
        safe = vm.addr(0xBEEF);
        authorizer = vm.addr(INTENT_SIGNER_PK);

        // Deploy a delegate implementation whose runtime code we will "run as" the compromised EOA.
        delegateImpl = new UniversalRecoveryDelegate(authorizer);

        // Deploy a local ERC-721 and mint one token to the compromised address.
        nft = new TestMintERC721("TestNFT", "TNFT");
        nft.mint(compromised);
        assertEq(nft.ownerOf(0), compromised, "unexpected initial owner");

        // Deploy a local ERC-20 and mint to the compromised address.
        erc20 = new TestMintERC20("TestToken", "TT");
        erc20.mint(compromised, 1_000e18);
    }

    function testLocal_MoveNftWithIntent() public {
        // Mimic ERC-7702 delegation by assigning the delegate runtime code to the compromised address.
        vm.etch(compromised, address(delegateImpl).code);

        UniversalRecoveryDelegate.Call[] memory calls = new UniversalRecoveryDelegate.Call[](1);
        calls[0] = UniversalRecoveryDelegate.Call({
            to: address(nft),
            value: 0,
            data: abi.encodeWithSelector(nft.transferFrom.selector, compromised, safe, 0)
        });

        uint256 nonce = 0;
        uint256 deadline = 0;
        (bytes32 digest,) = UniversalRecoveryDelegate(compromised).recoveryIntentDigest(safe, calls, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(INTENT_SIGNER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // Anyone can submit once they have the signature.
        UniversalRecoveryDelegate(compromised).executeBatchRecovery(safe, calls, authorizer, nonce, deadline, sig);

        assertEq(nft.ownerOf(0), safe, "owner did not change");
    }

    function testLocal_ReplayFailsByNonce() public {
        vm.etch(compromised, address(delegateImpl).code);

        UniversalRecoveryDelegate.Call[] memory calls = new UniversalRecoveryDelegate.Call[](0);

        uint256 nonce = 0;
        uint256 deadline = 0;
        (bytes32 digest,) = UniversalRecoveryDelegate(compromised).recoveryIntentDigest(safe, calls, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(INTENT_SIGNER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        UniversalRecoveryDelegate(compromised).executeBatchRecovery(safe, calls, authorizer, nonce, deadline, sig);

        // Same calldata/signature replay should fail (nonce already consumed).
        vm.expectRevert(abi.encodeWithSelector(UniversalRecoveryDelegate.InvalidNonce.selector, authorizer, 1, 0));
        UniversalRecoveryDelegate(compromised).executeBatchRecovery(safe, calls, authorizer, nonce, deadline, sig);
    }

    function testLocal_RecoverMultipleAssetsBatch() public {
        // Mint a second NFT to recover as well.
        nft.mint(compromised); // tokenId=1
        assertEq(nft.ownerOf(0), compromised);
        assertEq(nft.ownerOf(1), compromised);

        // Fund the compromised account with ETH so the final sweep is meaningful.
        vm.deal(compromised, 2 ether);
        uint256 safeEthBefore = safe.balance;

        // Enable delegation after all mints.
        vm.etch(compromised, address(delegateImpl).code);

        UniversalRecoveryDelegate.Call[] memory calls = new UniversalRecoveryDelegate.Call[](3);
        calls[0] = UniversalRecoveryDelegate.Call({
            to: address(nft),
            value: 0,
            data: abi.encodeWithSelector(nft.transferFrom.selector, compromised, safe, 0)
        });
        calls[1] = UniversalRecoveryDelegate.Call({
            to: address(nft),
            value: 0,
            data: abi.encodeWithSelector(nft.transferFrom.selector, compromised, safe, 1)
        });
        calls[2] = UniversalRecoveryDelegate.Call({
            to: address(erc20),
            value: 0,
            data: abi.encodeWithSelector(erc20.transfer.selector, safe, 250e18)
        });

        uint256 nonce = 0;
        uint256 deadline = 0;
        (bytes32 digest,) = UniversalRecoveryDelegate(compromised).recoveryIntentDigest(safe, calls, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(INTENT_SIGNER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        UniversalRecoveryDelegate(compromised).executeBatchRecovery(safe, calls, authorizer, nonce, deadline, sig);

        // Token recoveries
        assertEq(nft.ownerOf(0), safe);
        assertEq(nft.ownerOf(1), safe);
        assertEq(erc20.balanceOf(safe), 250e18);

        // ETH sweep (no other ETH movements in the batch)
        assertEq(safe.balance, safeEthBefore + 2 ether);
        assertEq(compromised.balance, 0);
    }

    function testLocal_CopiedCalldataFailsOnOtherDelegatedAccount() public {
        // Attacker uses their own delegated account (different `address(this)` => different EIP-712 domain).
        address payable attackerDelegated = payable(vm.addr(0xD00D));
        vm.etch(attackerDelegated, address(delegateImpl).code);
        vm.etch(compromised, address(delegateImpl).code);

        UniversalRecoveryDelegate.Call[] memory calls = new UniversalRecoveryDelegate.Call[](0);
        uint256 nonce = 0;
        uint256 deadline = 0;

        // Signature was created for `verifyingContract = compromised`, not attackerDelegated.
        (bytes32 digestForCompromised,) =
            UniversalRecoveryDelegate(compromised).recoveryIntentDigest(safe, calls, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(INTENT_SIGNER_PK, digestForCompromised);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(UniversalRecoveryDelegate.InvalidSignature.selector);
        UniversalRecoveryDelegate(attackerDelegated).executeBatchRecovery(safe, calls, authorizer, nonce, deadline, sig);
    }
}

