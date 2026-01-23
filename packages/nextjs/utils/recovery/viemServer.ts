import { type Chain, defineChain } from "viem";
import * as viemChains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";
import { getAlchemyHttpUrl } from "~~/utils/scaffold-eth/networks";

const viemChainsById = (() => {
  const m = new Map<number, viemChains.Chain>();
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === "object" && "id" in v) m.set((v as viemChains.Chain).id, v as viemChains.Chain);
  }
  return m;
})();

export function getRpcUrl(chainId?: number): string {
  if (typeof chainId === "number") {
    const override = scaffoldConfig.rpcOverrides?.[chainId];
    if (override) return override;

    // Local dev chain
    if (chainId === 31337) return process.env.LOCAL_RPC_URL || process.env.RPC_URL || "http://127.0.0.1:8545";

    const alchemy = getAlchemyHttpUrl(chainId);
    if (alchemy) return alchemy;

    // Fallback to viem's built-in chain RPCs if available.
    const viemChain = viemChainsById.get(chainId);
    const viemRpc = viemChain?.rpcUrls?.default?.http?.[0] ?? viemChain?.rpcUrls?.public?.http?.[0];
    if (viemRpc) return viemRpc;
  }

  return process.env.RPC_URL || process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
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
