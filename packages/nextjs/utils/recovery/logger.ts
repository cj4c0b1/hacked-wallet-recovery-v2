import { randomUUID } from "crypto";
import { safeJsonStringify } from "~~/utils/recovery/jsonSafe";

/**
 * Request-scoped structured logging for the recovery API routes.
 *
 * Goal: when a user's recovery attempt fails, leave enough detail in the Vercel
 * function logs to diagnose the bug — without ever logging secrets.
 *
 * SAFE to log: addresses, tx hashes, chainIds, nonces, gas, fees, revert data,
 * error messages/codes/cause chains.
 *
 * NEVER log: the paymaster private key, or raw signature material before broadcast
 * (EIP-7702 authorization r/s, the intent signature, the quote signature). The
 * user's wallet private key never reaches the server at all — it stays in their
 * browser — so there is nothing to redact for it here; keep it that way.
 */

export function mkReqId(): string {
  try {
    return randomUUID();
  } catch {
    // randomUUID can be unavailable in some edge/runtime contexts; fall back.
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }
}

/**
 * Normalize an unknown error (often a nested viem error) into a flat, JSON-safe
 * object, walking the `cause` chain so the underlying RPC/network failure isn't
 * hidden behind a generic wrapper message.
 */
export function safeErr(e: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: typeof e?.name === "string" ? e.name : null,
    code: e?.code ?? e?.errorCode ?? null,
    status: e?.status ?? null,
    shortMessage: typeof e?.shortMessage === "string" ? e.shortMessage : null,
    message: typeof e?.message === "string" ? e.message : String(e),
  };

  // Walk the cause chain (viem nests the real failure in `cause`). Cap depth to
  // avoid runaway/circular structures.
  const causes: Record<string, unknown>[] = [];
  let cur = e?.cause;
  let depth = 0;
  const seen = new Set<unknown>();
  while (cur && depth < 5 && !seen.has(cur)) {
    seen.add(cur);
    causes.push({
      name: typeof cur?.name === "string" ? cur.name : null,
      code: cur?.code ?? cur?.errorCode ?? null,
      status: cur?.status ?? null,
      shortMessage: typeof cur?.shortMessage === "string" ? cur.shortMessage : null,
      message: typeof cur?.message === "string" ? cur.message : String(cur),
    });
    cur = cur?.cause;
    depth += 1;
  }
  if (causes.length) out.causes = causes;
  return out;
}

export type RecoveryLogger = {
  reqId: string;
  /** Lifecycle/progress events on the happy path. */
  info: (event: string, data?: unknown) => void;
  /** Recoverable problems (RPC fell over, a single chain failed, etc.). */
  warn: (event: string, data?: unknown) => void;
  /** Failures: top-level catches and unrecoverable per-chain errors. */
  error: (event: string, data?: unknown) => void;
  /** Derive a child logger with extra context baked into the prefix (e.g. a chainId). */
  child: (suffix: string) => RecoveryLogger;
};

function emit(level: "info" | "warn" | "error", prefix: string, event: string, data?: unknown) {
  const line = `${prefix} ${event}`;
  if (data === undefined) {
    console[level](line);
    return;
  }
  // BigInt-safe serialization; one line so Vercel keeps it as a single log entry.
  console[level](line, safeJsonStringify(data));
}

/**
 * Build a request-scoped logger. `scope` is the route name (e.g. "execute"),
 * and every line is prefixed `[hwr.<scope> <reqId>]` to match the existing
 * convention in /api/quote and to make grepping by request trivial.
 */
export function mkLogger(scope: string, reqId: string): RecoveryLogger {
  const build = (prefix: string): RecoveryLogger => ({
    reqId,
    info: (event, data) => emit("info", prefix, event, data),
    warn: (event, data) => emit("warn", prefix, event, data),
    error: (event, data) => emit("error", prefix, event, data),
    child: suffix => build(`${prefix}${suffix}`),
  });
  return build(`[hwr.${scope} ${reqId}]`);
}
