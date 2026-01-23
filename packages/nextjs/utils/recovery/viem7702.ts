import type { Address, Hex } from "viem";
import { signAuthorization } from "viem/accounts";

export function normalizeHexPrivateKey(value: string): Hex | null {
  // Accept common paste formats:
  // - with or without 0x/0X prefix
  // - with whitespace/newlines
  // - wrapped in quotes
  const cleaned = value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) return null;

  const match = /^(?:0x)?([0-9a-fA-F]{64})$/i.exec(cleaned);
  if (!match) return null;

  return `0x${match[1]}` as Hex;
}

export async function sign7702Authorization(params: {
  privateKey: Hex;
  chainId: number;
  nonce: number;
  contractAddress: Address;
}) {
  return await signAuthorization({
    privateKey: params.privateKey,
    chainId: params.chainId,
    nonce: params.nonce,
    contractAddress: params.contractAddress,
  });
}
