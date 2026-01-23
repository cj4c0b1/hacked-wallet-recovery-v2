import type { DelegateCall } from "./calls";
import type { Address, Authorization, Hex, PublicClient } from "viem";
import {
  bytesToHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBigInt,
  isHex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
} from "viem";

const CALL_TYPEHASH = keccak256(stringToHex("Call(address to,uint256 value,bytes data)"));

export function hashCalls(calls: DelegateCall[]): Hex {
  const callHashes: Hex[] = calls.map(c =>
    keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32,address,uint256,bytes32"), [
        CALL_TYPEHASH,
        c.to,
        c.value,
        keccak256(c.data),
      ]),
    ),
  );
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32[]"), [callHashes]));
}

const NONCES_ABI = parseAbi(["function nonces(address) view returns (uint256)"]);

// Matches Solidity:
// bytes32(uint256(keccak256("hwr.universalRecoveryDelegate.storage.v1")) - 1)
const DELEGATE_STORAGE_SLOT: Hex = (() => {
  const h = keccak256(stringToHex("hwr.universalRecoveryDelegate.storage.v1"));
  const slot = hexToBigInt(h) - 1n;
  return toHex(slot, { size: 32 }) as Hex;
})();

function toViemAuthorization(authorization: Authorization) {
  // Viem's EIP-7702 helpers historically used `contractAddress` naming, while some
  // parts of the codebase (and `recoverAuthorizationAddress`) use `address`.
  // Provide both to avoid runtime serialization crashes inside viem.
  const a: any = authorization as any;
  const contractAddress = (a?.contractAddress ?? a?.address) as Address | undefined;
  return { ...a, contractAddress };
}

function normalizeCallResultToHex(res: unknown): Hex {
  // viem return shapes vary a bit across versions/bundling:
  // - Hex string
  // - { data: Hex }
  // - (rare) { result: Hex } or bytes-like payloads
  if (typeof res === "string") return res as Hex;
  if (res instanceof Uint8Array) return bytesToHex(res);
  // Node Buffer is a Uint8Array subclass, but keep explicit for clarity.
  const anyRes: any = res as any;
  if (anyRes && typeof anyRes === "object") {
    const candidate = anyRes.data ?? anyRes.result ?? anyRes.returnData ?? anyRes.value;
    if (typeof candidate === "string") return candidate as Hex;
    if (candidate instanceof Uint8Array) return bytesToHex(candidate);
    if (candidate && typeof candidate === "object" && candidate.type === "Buffer" && Array.isArray(candidate.data)) {
      return bytesToHex(Uint8Array.from(candidate.data));
    }
  }
  throw new Error("Unexpected eth_call result shape (missing return data).");
}

export async function readIntentNonce(params: {
  publicClient: PublicClient;
  chainId: number;
  compromisedAddress: Address;
  authorization: Authorization;
  authorizer: Address;
  caller: Address;
}): Promise<bigint> {
  // Preferred path: read from EOA storage via `eth_getStorageAt` (broad RPC support).
  // Storage layout:
  // - DelegateStorage is anchored at `DELEGATE_STORAGE_SLOT`
  // - `mapping(address => uint256) nonces` is the first field => mapping slot == DELEGATE_STORAGE_SLOT
  // - mapping entry slot = keccak256(abi.encode(key, mappingSlot))
  try {
    const slot = keccak256(
      encodeAbiParameters(parseAbiParameters("address,bytes32"), [params.authorizer, DELEGATE_STORAGE_SLOT]),
    );
    const raw = await params.publicClient.getStorageAt({ address: params.compromisedAddress, slot });
    return hexToBigInt(raw ?? "0x0");
  } catch {
    // Fallback path: read via delegated `eth_call` (requires EIP-7702 support on RPC).
    const data = encodeFunctionData({
      abi: NONCES_ABI,
      functionName: "nonces",
      args: [params.authorizer],
    });
    const res = await params.publicClient.call({
      to: params.compromisedAddress,
      data,
      account: params.caller,
      type: "eip7702",
      authorizationList: [toViemAuthorization(params.authorization)],
      chainId: params.chainId,
    } as any);
    const resultHex = normalizeCallResultToHex(res);
    if (!isHex(resultHex)) {
      throw new Error(`Unexpected eth_call return data (not hex): ${String(resultHex).slice(0, 80)}`);
    }
    return decodeFunctionResult({
      abi: NONCES_ABI,
      functionName: "nonces",
      data: resultHex,
    }) as bigint;
  }
}

export function typedDataForRecoveryIntent(params: {
  chainId: number;
  verifyingContract: Address; // MUST be the compromised delegated EOA address (address(this) under 7702)
  recoveryAddress: Address;
  callsHash: Hex;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: {
      name: "UniversalRecoveryDelegate",
      version: "1",
      chainId: params.chainId,
      verifyingContract: params.verifyingContract,
    },
    primaryType: "RecoveryIntent" as const,
    types: {
      RecoveryIntent: [
        { name: "recoveryAddress", type: "address" },
        { name: "callsHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    message: {
      recoveryAddress: params.recoveryAddress,
      callsHash: params.callsHash,
      nonce: params.nonce,
      deadline: params.deadline,
    } as const,
  };
}
