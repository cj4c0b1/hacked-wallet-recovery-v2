import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

type ChainAttributes = {
  // color | [lightThemeColor, darkThemeColor]
  color: string | [string, string];
  // Used to fetch price by providing mainnet token address
  // for networks having native currency other than ETH
  nativeCurrencyTokenAddress?: string;
};

export type ChainWithAttributes = chains.Chain & Partial<ChainAttributes>;
export type AllowedChainIds = (typeof scaffoldConfig.targetNetworks)[number]["id"];

// Preferred ordering for network selectors throughout the app.
// Then sort alphabetically (by `name`) for the remainder.
export const PREFERRED_CHAIN_IDS: number[] = [
  chains.mainnet.id,
  chains.arbitrum.id,
  chains.base.id,
  chains.optimism.id,
];

export function sortNetworksForDropdown<T extends { id: number; name?: string }>(nets: T[]): T[] {
  const prefIndex = new Map<number, number>(PREFERRED_CHAIN_IDS.map((id, i) => [id, i]));
  return [...nets].sort((a, b) => {
    const ai = prefIndex.has(a.id) ? (prefIndex.get(a.id) as number) : Number.POSITIVE_INFINITY;
    const bi = prefIndex.has(b.id) ? (prefIndex.get(b.id) as number) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    // If there are conflicting IDs, prefer non-testnets first.
    const aTestnet = (a as any)?.testnet === true;
    const bTestnet = (b as any)?.testnet === true;
    if (aTestnet !== bTestnet) return aTestnet ? 1 : -1;
    const an = String(a.name ?? "").toLowerCase();
    const bn = String(b.name ?? "").toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id - b.id;
  });
}

// Mapping of chainId to RPC chain name an format followed by alchemy and infura
export const RPC_CHAIN_NAMES: Record<number, string> = {
  [chains.mainnet.id]: "eth-mainnet",
  [chains.goerli.id]: "eth-goerli",
  [chains.sepolia.id]: "eth-sepolia",
  [chains.optimism.id]: "opt-mainnet",
  [chains.optimismGoerli.id]: "opt-goerli",
  [chains.optimismSepolia.id]: "opt-sepolia",
  [chains.arbitrum.id]: "arb-mainnet",
  [chains.arbitrumGoerli.id]: "arb-goerli",
  [chains.arbitrumSepolia.id]: "arb-sepolia",
  [chains.polygon.id]: "polygon-mainnet",
  [chains.polygonMumbai.id]: "polygon-mumbai",
  [chains.polygonAmoy.id]: "polygon-amoy",
  [chains.astar.id]: "astar-mainnet",
  [chains.polygonZkEvm.id]: "polygonzkevm-mainnet",
  [chains.polygonZkEvmTestnet.id]: "polygonzkevm-testnet",
  [chains.base.id]: "base-mainnet",
  [chains.baseGoerli.id]: "base-goerli",
  [chains.baseSepolia.id]: "base-sepolia",
  [chains.celo.id]: "celo-mainnet",
  [chains.celoSepolia.id]: "celo-sepolia",
};

export const getAlchemyHttpUrl = (chainId: number) => {
  return scaffoldConfig.alchemyApiKey && RPC_CHAIN_NAMES[chainId]
    ? `https://${RPC_CHAIN_NAMES[chainId]}.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`
    : undefined;
};

export const NETWORKS_EXTRA_DATA: Record<string, ChainAttributes> = {
  [chains.hardhat.id]: {
    color: "#b8af0c",
  },
  8545: {
    color: "#b8af0c",
  },
  [chains.mainnet.id]: {
    color: "#ff8b9e",
  },
  [chains.sepolia.id]: {
    color: ["#5f4bb6", "#87ff65"],
  },
  [chains.gnosis.id]: {
    color: "#48a9a6",
  },
  [chains.polygon.id]: {
    color: "#2bbdf7",
    nativeCurrencyTokenAddress: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
  },
  [chains.polygonMumbai.id]: {
    color: "#92D9FA",
    nativeCurrencyTokenAddress: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
  },
  [chains.optimismSepolia.id]: {
    color: "#f01a37",
  },
  [chains.optimism.id]: {
    color: "#f01a37",
  },
  [chains.arbitrumSepolia.id]: {
    color: "#28a0f0",
  },
  [chains.arbitrum.id]: {
    color: "#28a0f0",
  },
  [chains.fantom.id]: {
    color: "#1969ff",
  },
  [chains.fantomTestnet.id]: {
    color: "#1969ff",
  },
  [chains.scrollSepolia.id]: {
    color: "#fbebd4",
  },
  [chains.celo.id]: {
    color: "#FCFF52",
  },
  [chains.celoSepolia.id]: {
    color: "#476520",
  },
};

/**
 * Gives the block explorer transaction URL.
 * - For local chains (Hardhat/8545), points to the app's built-in block explorer.
 */
export function getBlockExplorerTxLink(chainId: number, txnHash: string) {
  // Prefer configured target network to avoid rare chainId collisions in upstream chain registries.
  const configured = getTargetNetworkById(chainId);
  const configuredUrl = configured?.blockExplorers?.default?.url;
  if (configuredUrl) return `${configuredUrl}/tx/${txnHash}`;

  if (chainId === chains.hardhat.id || chainId === 8545) {
    return `/blockexplorer/transaction/${txnHash}`;
  }

  const chainNames = Object.keys(chains);

  const targetChainArr = chainNames.filter(chainName => {
    const wagmiChain = chains[chainName as keyof typeof chains];
    return wagmiChain.id === chainId;
  });

  if (targetChainArr.length === 0) {
    return "";
  }

  const targetChain = targetChainArr[0] as keyof typeof chains;
  const blockExplorerTxURL = chains[targetChain]?.blockExplorers?.default?.url;

  if (!blockExplorerTxURL) {
    return "";
  }

  return `${blockExplorerTxURL}/tx/${txnHash}`;
}

/**
 * Gives the block explorer URL for a given address.
 * Defaults to Etherscan if no (wagmi) block explorer is configured for the network.
 */
export function getBlockExplorerAddressLink(network: chains.Chain, address: string) {
  const blockExplorerBaseURL = network.blockExplorers?.default?.url;
  if (network.id === chains.hardhat.id || network.id === 8545) {
    return `/blockexplorer/address/${address}`;
  }

  if (!blockExplorerBaseURL) {
    return `https://etherscan.io/address/${address}`;
  }

  return `${blockExplorerBaseURL}/address/${address}`;
}

/**
 * @returns targetNetworks array containing networks configured in scaffold.config including extra network metadata
 */
export function getTargetNetworks(): ChainWithAttributes[] {
  return sortNetworksForDropdown(
    scaffoldConfig.targetNetworks.map(targetNetwork => ({
      ...targetNetwork,
      ...NETWORKS_EXTRA_DATA[targetNetwork.id],
    })),
  );
}

/**
 * Resolve a configured target network (chain) by chainId, including any extra metadata.
 * Useful for components (like `Address`) that need the correct chain to build explorer links.
 */
export function getTargetNetworkById(chainId?: number | null): ChainWithAttributes | undefined {
  if (typeof chainId !== "number" || !Number.isFinite(chainId)) return undefined;
  // Some chain definitions across ecosystems can (rarely) conflict on `id`.
  // Prefer non-testnets when there are multiple matches.
  const matches = scaffoldConfig.targetNetworks.filter(n => n.id === chainId);
  const targetNetwork =
    matches.find(n => (n as any).testnet !== true) ?? matches.find(n => (n as any).testnet === true) ?? matches[0];
  if (!targetNetwork) return undefined;
  return {
    ...targetNetwork,
    ...NETWORKS_EXTRA_DATA[targetNetwork.id],
  };
}
