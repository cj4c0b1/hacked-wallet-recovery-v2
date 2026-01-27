export const DEFAULT_SERVICE_FEE_USD = 5; // $5.00 default

export function getServiceFeeUsdMicros(): bigint {
  const raw = process.env.SERVICE_FEE_USD ?? process.env.NEXT_PUBLIC_SERVICE_FEE_USD;
  const n = raw && raw.trim() ? Number(raw) : DEFAULT_SERVICE_FEE_USD;
  if (!Number.isFinite(n) || n < 0) return BigInt(Math.round(DEFAULT_SERVICE_FEE_USD * 1_000_000));
  return BigInt(Math.round(n * 1_000_000));
}
