export type GasLimitEstimate = {
  /** Gas limit we will actually put on the transaction (already padded/clamped). */
  gas: bigint;
  /** Raw `eth_estimateGas` result (if available). */
  estimatedGas: bigint | null;
  /** Latest block gasLimit (if available). */
  blockGasLimit: bigint | null;
  /** How we produced `gas`. */
  strategy: "estimate" | "fallback";
};

function clampBigint(x: bigint, lo: bigint, hi: bigint) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Returns a conservative max gas ceiling based on latest block gasLimit.
 * (Some RPCs accept absurdly high gas values, but others reject > block gas limit.)
 */
export async function getMaxTxGas(publicClient: any): Promise<{ maxGas: bigint; blockGasLimit: bigint | null }> {
  const block = await publicClient.getBlock({ blockTag: "latest" }).catch(() => null);
  const blockGasLimit = (block?.gasLimit as bigint | undefined) ?? null;
  // Use 95% of block gas limit as ceiling to reduce "exceeds block gas limit" errors.
  const maxGas = blockGasLimit ? (blockGasLimit * 95n) / 100n : 5_000_000n;
  return { maxGas, blockGasLimit };
}

/**
 * Pads an estimate with a small buffer, plus a per-call buffer, and clamps it.
 *
 * Notes:
 * - EIP-7702 gas estimation can be optimistic on some RPCs.
 * - Hard floors like 750k tend to wildly over-allocate on simple executions.
 */
export function padGasLimit(opts: {
  estimatedGas: bigint;
  callsCount?: number;
  minGas?: bigint;
  maxGas: bigint;
}): bigint {
  const callsCount = Number.isFinite(opts.callsCount) ? Math.max(0, Math.floor(opts.callsCount ?? 0)) : 0;
  const minGas = opts.minGas ?? 200_000n;

  // 20% + 50k base buffer, plus 15k per call in the batch.
  const pctBuffer = opts.estimatedGas / 5n;
  const baseBuffer = 50_000n;
  const perCallBuffer = BigInt(callsCount) * 15_000n;
  const padded = opts.estimatedGas + pctBuffer + baseBuffer + perCallBuffer;

  return clampBigint(padded, minGas, opts.maxGas);
}

export function fallbackGasLimit(opts: { maxGas: bigint; minGas?: bigint }): bigint {
  const minGas = opts.minGas ?? 200_000n;
  // Reasonable default for a multi-call recovery batch, but still clamped by block gas limit.
  return clampBigint(1_500_000n, minGas, opts.maxGas);
}
