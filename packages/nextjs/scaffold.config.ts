import { defineChain } from "viem";
import * as chains from "viem/chains";
import externalContracts from "~~/contracts/externalContracts";

export type BaseConfig = {
  targetNetworks: readonly chains.Chain[];
  pollingInterval: number;
  alchemyApiKey: string;
  rpcOverrides?: Record<number, string>;
  walletConnectProjectId: string;
  onlyLocalBurnerWallet: boolean;
};

export type ScaffoldConfig = BaseConfig;

export const DEFAULT_ALCHEMY_API_KEY = "cR4WnXePioePZ5fFrnSiR";

const rpcOverrides: Record<number, string> = {
  // Example:
  [chains.mainnet.id]: "https://mainnet.rpc.buidlguidl.com",
  // [chains.base.id]: "https://base-mainnet.infura.io/v3/645d6bd74c4a4faabf1c469e5a4d1988",
  // [chains.gnosis.id]: "https://rpc.gnosischain.com",
  // [chains.polygon.id]: "https://polygon-mainnet.infura.io/v3/645d6bd74c4a4faabf1c469e5a4d1988",
  // [chains.arbitrum.id]: "https://arbitrum-mainnet.infura.io/v3/645d6bd74c4a4faabf1c469e5a4d1988",
  // [chains.optimism.id]: "https://optimism-mainnet.infura.io/v3/645d6bd74c4a4faabf1c469e5a4d1988",
};

const customChainsById: Record<number, chains.Chain> = {
  988: defineChain({
    id: 988,
    name: "Stable",
    nativeCurrency: { name: "gUSDT", symbol: "gUSDT", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.stable.xyz"] },
      public: { http: ["https://rpc.stable.xyz"] },
    },
  }),
};

const viemChainsById = (() => {
  const m = new Map<number, chains.Chain>();
  for (const v of Object.values(chains)) {
    if (v && typeof v === "object" && "id" in v) {
      const next = v as chains.Chain;
      const id = next.id;
      const existing = m.get(id);
      if (!existing) {
        m.set(id, next);
        continue;
      }
      // Handle rare chainId collisions in upstream chain definitions.
      // Prefer non-testnets over testnets when both share the same `id`.
      const existingTestnet = (existing as any)?.testnet === true;
      const nextTestnet = (next as any)?.testnet === true;
      if (existingTestnet && !nextTestnet) {
        m.set(id, next);
        continue;
      }
      // Otherwise keep the first-seen chain.
    }
  }
  return m;
})();

const targetNetworksFromExternalContracts = (() => {
  const ids = Object.keys(externalContracts)
    .map(Number)
    .filter((x): x is number => Number.isFinite(x))
    .sort((a, b) => a - b);
  const nets = ids
    .map(id => viemChainsById.get(id) ?? customChainsById[id])
    .filter((x): x is chains.Chain => Boolean(x));
  return nets as readonly chains.Chain[];
})();

const scaffoldConfig = {
  // The networks on which your DApp is live
  targetNetworks: targetNetworksFromExternalContracts,
  // The interval at which your front-end polls the RPC servers for new data (it has no effect if you only target the local network (default is 4000))
  pollingInterval: 30000,
  // This is ours Alchemy's default API key.
  // You can get your own at https://dashboard.alchemyapi.io
  // It's recommended to store it in an env variable:
  // .env.local for local testing, and in the Vercel/system env config for live apps.
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || DEFAULT_ALCHEMY_API_KEY,
  // If you want to use a different RPC for a specific network, you can add it here.
  // The key is the chain ID, and the value is the HTTP RPC URL
  rpcOverrides,
  // This is ours WalletConnect's default project ID.
  // You can get your own at https://cloud.walletconnect.com
  // It's recommended to store it in an env variable:
  // .env.local for local testing, and in the Vercel/system env config for live apps.
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
  onlyLocalBurnerWallet: true,
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
