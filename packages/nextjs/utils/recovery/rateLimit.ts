type Bucket = { count: number; resetAt: number };

// Very small in-memory rate limiter for Route Handlers (dev/MVP).
// Not suitable for multi-instance deployments.
const buckets = new Map<string, Bucket>();

export function rateLimit(params: { key: string; limit: number; windowMs: number }) {
  const now = Date.now();
  const bucket = buckets.get(params.key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(params.key, { count: 1, resetAt: now + params.windowMs });
    return { ok: true, remaining: params.limit - 1, resetAt: now + params.windowMs };
  }

  if (bucket.count >= params.limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  buckets.set(params.key, bucket);
  return { ok: true, remaining: params.limit - bucket.count, resetAt: bucket.resetAt };
}
