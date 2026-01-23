import { parseEther } from "viem";

/**
 * Fixed service fee per payment chain, denominated in that chain's native asset.
 *
 * If a chain is not listed, we fall back to DEFAULT_SERVICE_FEE_WEI.
 *
 * Example overrides:
 *   export const SERVICE_FEE_WEI_BY_CHAIN: Record<number, bigint> = {
 *     1: parseEther("0.003"), // Ethereum mainnet
 *     137: parseEther("0.003"), // Polygon
 *   };
 */
export const SERVICE_FEE_WEI_BY_CHAIN: Record<number, bigint> = {};

export const DEFAULT_SERVICE_FEE_WEI = parseEther("0.00000001");

export function getServiceFeeWei(chainId?: number): bigint {
  if (typeof chainId === "number") {
    const fee = SERVICE_FEE_WEI_BY_CHAIN[chainId];
    if (typeof fee === "bigint") return fee;
  }
  return DEFAULT_SERVICE_FEE_WEI;
}

// New: service fee defined in USD (preferred for multi-chain reimbursements + token payments).
// If set, quote/execute should convert this USD amount to the chosen payment asset.
export const DEFAULT_SERVICE_FEE_USD = 0.01; // $2.00 default

export function getServiceFeeUsdMicros(): bigint {
  const raw = process.env.SERVICE_FEE_USD ?? process.env.NEXT_PUBLIC_SERVICE_FEE_USD;
  const n = raw && raw.trim() ? Number(raw) : DEFAULT_SERVICE_FEE_USD;
  if (!Number.isFinite(n) || n < 0) return BigInt(Math.round(DEFAULT_SERVICE_FEE_USD * 1_000_000));
  return BigInt(Math.round(n * 1_000_000));
}
