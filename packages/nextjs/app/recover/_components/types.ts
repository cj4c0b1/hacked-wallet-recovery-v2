import type { Address, Hex } from "viem";

export type AssetStandard = "native" | "erc20" | "erc721" | "erc1155" | "customcall";

export type RecoveryAsset = {
  chainId: number;
  standard: AssetStandard;
  contract: Address;
  tokenId?: string; // for ERC721/ERC1155
  amount?: string; // for ERC20/ERC1155
  // For custom contract calls:
  functionSignature?: string; // e.g. "transfer(address,uint256)"
  args?: string[]; // raw user inputs (server coerces to ABI types)
  dataHex?: Hex; // raw calldata hex (alternative to functionSignature+args)
  valueWei?: string; // wei, base-10
  origin?: "scan" | "custom"; // UI-only metadata
};

export type SignedAuthorizationObject = {
  address: Address;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  /**
   * EIP-7702 expects `yParity` (0/1). Some tooling returns `v` (27/28).
   * We store `yParity` to match node expectations (e.g. anvil).
   */
  yParity: 0 | 1;
  /**
   * Backwards-compat: older sessions may still persist `v`.
   * Server endpoints accept either and normalize to `yParity`.
   */
  v?: bigint;
};
