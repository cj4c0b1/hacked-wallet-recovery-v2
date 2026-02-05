import { type Chain, defineChain } from "viem";
import * as viemChains from "viem/chains";
import scaffoldConfig, { DEFAULT_ALCHEMY_API_KEY } from "~~/scaffold.config";
import { getAlchemyHttpUrl } from "~~/utils/scaffold-eth/networks";

/**
 * Public RPC fallbacks for chains where `viem/chains` ships only a single
 * rate-limited endpoint (e.g. thirdweb).
 *
 * Keep these **read-only** (no private mempool / relay RPCs).
 */
const PUBLIC_RPC_FALLBACKS: Record<number, string[]> = {
  // BNB Smart Chain (BSC)
  56: [
    "https://bsc-dataseed.binance.org",
    "https://bsc.publicnode.com",
    "https://rpc.ankr.com/bsc",
    "https://binance.llamarpc.com",
  ],
};

let envRpcFallbacksCache: Record<number, string[]> | null = null;
function getEnvRpcFallbacks(chainId: number): string[] {
  if (!envRpcFallbacksCache) {
    const raw = process.env.RPC_FALLBACK_URLS_JSON || process.env.RPC_URLS_BY_CHAIN_ID_JSON;
    if (!raw) {
      envRpcFallbacksCache = {};
    } else {
      try {
        const parsed = JSON.parse(raw);
        const out: Record<number, string[]> = {};
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            const id = Number(k);
            if (!Number.isFinite(id)) continue;
            if (Array.isArray(v)) out[id] = v.filter(x => typeof x === "string");
            else if (typeof v === "string") out[id] = [v];
          }
        }
        envRpcFallbacksCache = out;
      } catch {
        envRpcFallbacksCache = {};
      }
    }
  }
  return envRpcFallbacksCache[chainId] ?? [];
}

function hasValidAlchemyKey(): boolean {
  // `scaffoldConfig.alchemyApiKey` always has *some* value due to defaults.
  // Treat it as "valid" only if the user provided their own key.
  return Boolean(scaffoldConfig.alchemyApiKey) && scaffoldConfig.alchemyApiKey !== DEFAULT_ALCHEMY_API_KEY;
}

// Execution-only RPCs (private mempool / relay RPCs).
// Important: these MUST NOT be used for general reads across the app; only for the execution phase.
const EXECUTION_RPC_OVERRIDES: Record<number, string> = {
  // Ethereum mainnet
  1: "https://rpc.flashbots.net/fast",
  // // Base mainnet - Not needed since sequencer only sees mempool
  // 8453: "https://base.blinklabs.xyz/v1/",
  // BSC mainnet
  56: "https://bsc.blinklabs.xyz/v1/",
  // // Arbitrum One - Not needed since sequencer only sees mempool
  // 42161: "https://arb.blinklabs.xyz/v1/",
  100: "https://erpc.gnosis.shutter.network",
};

const viemChainsById = (() => {
  const m = new Map<number, viemChains.Chain>();
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === "object" && "id" in v) m.set((v as viemChains.Chain).id, v as viemChains.Chain);
  }
  return m;
})();

/**
 * Returns a "public/default" RPC URL from viem chain definitions, bypassing
 * scaffold overrides and Alchemy URL generation.
 *
 * Useful as a fallback when a provider URL returns non-JSON or otherwise fails.
 */
export function getViemFallbackRpcUrl(chainId: number): string | null {
  // Avoid known chainId collision (HyperEVM=999); prefer configured target network RPC.
  const configured = scaffoldConfig.targetNetworks?.find(n => n.id === chainId);
  const configuredRpc = configured?.rpcUrls?.default?.http?.[0] ?? configured?.rpcUrls?.public?.http?.[0];
  if (configuredRpc) return configuredRpc;

  const viemChain = viemChainsById.get(chainId);
  return viemChain?.rpcUrls?.public?.http?.[0] ?? viemChain?.rpcUrls?.default?.http?.[0] ?? null;
}

export function getRpcUrl(chainId?: number): string {
  if (typeof chainId === "number") {
    const override = scaffoldConfig.rpcOverrides?.[chainId];
    if (override) return override;

    // Local dev chain
    if (chainId === 31337) return process.env.LOCAL_RPC_URL || process.env.RPC_URL || "http://127.0.0.1:8545";

    // Prefer configured target network RPCs (including custom chain defs in `scaffold.config.ts`).
    const configured = scaffoldConfig.targetNetworks?.find(n => n.id === chainId);
    const configuredRpc = configured?.rpcUrls?.default?.http?.[0] ?? configured?.rpcUrls?.public?.http?.[0];
    if (configuredRpc) return configuredRpc;

    const alchemy = getAlchemyHttpUrl(chainId);
    if (alchemy) return alchemy;

    // Fallback to viem's built-in chain RPCs if available.
    const viemChain = viemChainsById.get(chainId);
    const viemRpc = viemChain?.rpcUrls?.default?.http?.[0] ?? viemChain?.rpcUrls?.public?.http?.[0];
    if (viemRpc) return viemRpc;
  }

  return process.env.RPC_URL || process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
}

export function getRpcUrls(chainId: number): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (!s) return;
    if (!urls.includes(s)) urls.push(s);
  };

  // Highest priority: explicit overrides.
  push(scaffoldConfig.rpcOverrides?.[chainId]);

  // Local dev chain.
  if (chainId === 31337) {
    push(process.env.LOCAL_RPC_URL);
    push(process.env.RPC_URL);
    push("http://127.0.0.1:8545");
    return urls;
  }

  // Prefer configured target network RPCs (including custom chain defs in `scaffold.config.ts`).
  const configured = scaffoldConfig.targetNetworks?.find(n => n.id === chainId);
  for (const u of configured?.rpcUrls?.default?.http ?? []) push(u);
  for (const u of configured?.rpcUrls?.public?.http ?? []) push(u);

  // Alchemy (when available) should be the 2nd choice after the primary RPC.
  if (hasValidAlchemyKey()) {
    const alchemy = getAlchemyHttpUrl(chainId);
    if (typeof alchemy === "string") {
      const a = alchemy.trim();
      if (a) {
        const currentIndex = urls.indexOf(a);
        const desiredIndex = urls.length > 0 ? 1 : 0;
        if (currentIndex === -1) {
          urls.splice(desiredIndex, 0, a);
        } else if (currentIndex !== desiredIndex) {
          urls.splice(currentIndex, 1);
          urls.splice(desiredIndex, 0, a);
        }
      }
    }
  }

  // Extra public fallbacks (env-configured + built-in list for some chains).
  for (const u of getEnvRpcFallbacks(chainId)) push(u);
  for (const u of PUBLIC_RPC_FALLBACKS[chainId] ?? []) push(u);

  // viem's built-in chain RPCs.
  const viemChain = viemChainsById.get(chainId);
  for (const u of viemChain?.rpcUrls?.default?.http ?? []) push(u);
  for (const u of viemChain?.rpcUrls?.public?.http ?? []) push(u);

  // Last resort: whatever `getRpcUrl` resolves to.
  push(getRpcUrl(chainId));

  return urls;
}

/**
 * Returns an RPC list intended for *execution/broadcast* (not general reads).
 *
 * For selected networks, we prepend a private mempool RPC to reduce nonce-race risk.
 * We still keep public RPCs as fallback for:
 * - simulations/fee estimation
 * - receipt fetching
 * - resilience when private RPC is unavailable
 */
export function getExecuteRpcUrls(chainId: number): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (!s) return;
    if (!urls.includes(s)) urls.push(s);
  };

  push(EXECUTION_RPC_OVERRIDES[chainId]);
  for (const u of getRpcUrls(chainId)) push(u);
  return urls;
}

export function getChain(chainId: number, rpcUrl: string): Chain {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  });
}
