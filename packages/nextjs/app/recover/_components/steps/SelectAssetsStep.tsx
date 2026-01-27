"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PositionsOverview } from "../PositionsOverview";
import type { RecoveryAsset } from "../types";
import { AddressInput } from "@scaffold-ui/components";
import type { Address } from "viem";
import type { Hex } from "viem";
import { formatUnits, getAddress, isAddress, parseAbi, parseTransaction } from "viem";
import { getPublicClient } from "wagmi/actions";
import externalContracts from "~~/contracts/externalContracts";
import useFetchContractAbi from "~~/hooks/useFetchContractAbi";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import type { ZerionNftView, ZerionPositionsView } from "~~/utils/recovery/zerion";
import { getTargetNetworkById, sortNetworksForDropdown } from "~~/utils/scaffold-eth/networks";

function assetKey(asset: RecoveryAsset): string {
  const c = asset.contract.toLowerCase();
  if (asset.standard === "native") return `native:${asset.chainId}`;
  if (asset.standard === "erc20") return `erc20:${asset.chainId}:${c}`;
  if (asset.standard === "erc721") return `erc721:${asset.chainId}:${c}:${asset.tokenId ?? ""}`;
  if (asset.standard === "customcall") {
    const sig = (asset.functionSignature ?? "").trim();
    const args = Array.isArray(asset.args) ? asset.args.map(x => String(x ?? "")).join("|") : "";
    const v = (asset.valueWei ?? "").trim();
    const data = (asset.dataHex ?? "").trim();
    return `customcall:${asset.chainId}:${c}:${sig}:${args}:${v}:${data}`;
  }
  return `erc1155:${asset.chainId}:${c}:${asset.tokenId ?? ""}:${asset.amount ?? ""}`;
}

function functionSignatureFromAbi(fn: any): string | null {
  if (!fn || fn.type !== "function" || typeof fn.name !== "string") return null;
  const inputs = Array.isArray(fn.inputs) ? fn.inputs : [];
  const types = inputs.map((i: any) => String(i?.type ?? "").trim()).join(",");
  return `${fn.name}(${types})`;
}

function isWriteFunction(fn: any): boolean {
  if (!fn || fn.type !== "function") return false;
  const sm = String(fn.stateMutability ?? "");
  return sm === "nonpayable" || sm === "payable";
}

type OnchainTokenInfo = {
  balanceWei: string; // bigint string
  decimals: number;
  formatted: string; // decimal string
};

export function SelectAssetsStep(props: {
  compromisedAddress?: Address;
  assets: RecoveryAsset[];
  onChangeAssets: (next: RecoveryAsset[]) => void;
  positionsView: ZerionPositionsView | null;
  nfts: ZerionNftView[];
  selectedIndexes: number[];
  onChangeSelected: (indexes: number[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [tab, setTab] = useState<"tokens" | "nfts" | "custom">("tokens");
  const [showUnverified, setShowUnverified] = useState(false);
  const [customAddTab, setCustomAddTab] = useState<"signature" | "raw">("signature");
  const [customAttemptedAdd, setCustomAttemptedAdd] = useState(false);
  const [customTouched, setCustomTouched] = useState<{
    contract: boolean;
    functionSignature: boolean;
    rawTxHex: boolean;
  }>({
    contract: false,
    functionSignature: false,
    rawTxHex: false,
  });
  const selectedSet = useMemo(() => new Set(props.selectedIndexes), [props.selectedIndexes]);

  const [onchainTokenInfoByKey, setOnchainTokenInfoByKey] = useState<Record<string, OnchainTokenInfo>>({});
  const onchainLoadSeqRef = useRef(0);

  const supportedChainIds = useMemo(() => {
    return new Set(
      Object.keys(externalContracts)
        .map(Number)
        .filter((x): x is number => Number.isFinite(x)),
    );
  }, []);

  const isSupportedIndex = (i: number) => supportedChainIds.has(props.assets[i]?.chainId);

  const toggle = (i: number) => {
    // Never allow selecting assets on unsupported networks.
    // (But do allow de-selecting if something somehow got selected earlier.)
    if (!selectedSet.has(i) && !isSupportedIndex(i)) return;
    const next = new Set(selectedSet);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    props.onChangeSelected(Array.from(next).sort((a, b) => a - b));
  };

  const tokenIndexes = useMemo(
    () =>
      props.assets
        .map((a, i) => ({ a, i }))
        .filter(x => x.a.standard === "erc20" || x.a.standard === "native")
        .map(x => x.i),
    [props.assets],
  );
  const nftIndexes = useMemo(
    () =>
      props.assets
        .map((a, i) => ({ a, i }))
        .filter(x => x.a.standard === "erc721" || x.a.standard === "erc1155")
        .map(x => x.i),
    [props.assets],
  );
  const customIndexes = useMemo(
    () =>
      props.assets
        .map((a, i) => ({ a, i }))
        .filter(x => x.a.origin === "custom")
        .map(x => x.i),
    [props.assets],
  );

  const tokenSelectedCount = useMemo(
    () => tokenIndexes.filter(i => selectedSet.has(i)).length,
    [tokenIndexes, selectedSet],
  );
  const nftSelectedCount = useMemo(() => nftIndexes.filter(i => selectedSet.has(i)).length, [nftIndexes, selectedSet]);
  const customSelectedCount = useMemo(
    () => customIndexes.filter(i => selectedSet.has(i)).length,
    [customIndexes, selectedSet],
  );

  const indexByTokenKey = useMemo(() => {
    const map = new Map<string, number>();
    props.assets.forEach((a, i) => {
      if (a.standard !== "erc20" && a.standard !== "native") return;
      map.set(assetKey(a), i);
    });
    return map;
  }, [props.assets]);

  const indexByAssetKey = useMemo(() => {
    const map = new Map<string, number>();
    props.assets.forEach((a, i) => map.set(assetKey(a), i));
    return map;
  }, [props.assets]);

  const selectedTokenKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const i of tokenIndexes) {
      if (!selectedSet.has(i)) continue;
      keys.add(assetKey(props.assets[i]));
    }
    return keys;
  }, [props.assets, selectedSet, tokenIndexes]);

  const toggleTokenKey = (key: string) => {
    const idx = indexByTokenKey.get(key);
    if (idx == null) return;
    toggle(idx);
  };

  useEffect(() => {
    const run = async () => {
      if (!props.compromisedAddress) return;
      const seq = ++onchainLoadSeqRef.current;

      // Only look up balances for tokens we might transfer (native + ERC-20).
      const keysToFetch = tokenIndexes
        .map(i => ({ i, a: props.assets[i] }))
        .filter(x => x.a && supportedChainIds.has(x.a.chainId))
        .map(x => ({ i: x.i, a: x.a, key: assetKey(x.a) }));

      // De-dupe by key to avoid redundant RPC calls.
      const seen = new Set<string>();
      const uniq = keysToFetch.filter(x => {
        if (seen.has(x.key)) return false;
        seen.add(x.key);
        return true;
      });
      if (!uniq.length) return;

      const erc20Abi = parseAbi([
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
      ]);

      const updates: Record<string, OnchainTokenInfo> = {};
      await Promise.all(
        uniq.map(async ({ a, key }) => {
          try {
            const pc = getPublicClient(wagmiConfig as any, { chainId: a.chainId });
            if (!pc) return;
            if (a.standard === "native") {
              const bal = await pc.getBalance({ address: props.compromisedAddress! });
              const decimals = 18;
              updates[key] = {
                balanceWei: bal.toString(),
                decimals,
                formatted: formatUnits(bal, decimals),
              };
              return;
            }
            if (a.standard === "erc20") {
              const [bal, decimalsRaw] = await Promise.all([
                pc.readContract({
                  address: a.contract,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [props.compromisedAddress!],
                }) as Promise<unknown>,
                pc
                  .readContract({ address: a.contract, abi: erc20Abi, functionName: "decimals" })
                  .catch(() => 18) as Promise<unknown>,
              ]);
              const balBig = typeof bal === "bigint" ? bal : BigInt(String(bal ?? "0"));
              const decimals =
                typeof decimalsRaw === "number" && Number.isFinite(decimalsRaw)
                  ? Math.max(0, Math.min(255, Math.floor(decimalsRaw)))
                  : typeof decimalsRaw === "bigint"
                    ? Math.max(0, Math.min(255, Number(decimalsRaw)))
                    : 18;
              updates[key] = {
                balanceWei: balBig.toString(),
                decimals,
                formatted: formatUnits(balBig, decimals),
              };
            }
          } catch {
            // ignore
          }
        }),
      );

      if (onchainLoadSeqRef.current !== seq) return;
      if (Object.keys(updates).length) {
        setOnchainTokenInfoByKey(prev => ({ ...prev, ...updates }));

        // Clamp scanned ERC-20 amounts to exact onchain balances and auto-deselect zero balances.
        let changed = false;
        const nextAssets = props.assets.map(asset => {
          if (asset.standard !== "erc20") return asset;
          const k = assetKey(asset);
          const info = updates[k];
          if (!info) return asset;
          const nextAmount = info.balanceWei;
          if ((asset.amount ?? "0") === nextAmount) return asset;
          changed = true;
          return { ...asset, amount: nextAmount } as RecoveryAsset;
        });

        let nextSelected = props.selectedIndexes;
        const zeroSelected = new Set<number>();
        for (const i of props.selectedIndexes) {
          const a = props.assets[i];
          if (!a) continue;
          const k = a.standard === "erc20" || a.standard === "native" ? assetKey(a) : null;
          if (!k) continue;
          const info = updates[k];
          if (!info) continue;
          if (info.balanceWei === "0") zeroSelected.add(i);
        }
        if (zeroSelected.size) {
          nextSelected = props.selectedIndexes.filter(i => !zeroSelected.has(i));
        }

        if (changed) props.onChangeAssets(nextAssets);
        if (nextSelected !== props.selectedIndexes) props.onChangeSelected(nextSelected);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.compromisedAddress, props.assets, supportedChainIds, tokenIndexes]);

  const selectAllInTab = () => {
    const add = tab === "tokens" ? tokenIndexes : tab === "nfts" ? nftIndexes : customIndexes;
    const next = new Set(selectedSet);
    add.forEach(i => {
      if (!isSupportedIndex(i)) return;
      next.add(i);
    });
    props.onChangeSelected(Array.from(next).sort((a, b) => a - b));
  };
  const clearInTab = () => {
    const remove = new Set(tab === "tokens" ? tokenIndexes : tab === "nfts" ? nftIndexes : customIndexes);
    const next = props.selectedIndexes.filter(i => !remove.has(i));
    props.onChangeSelected(next);
  };

  const canNext = props.selectedIndexes.length > 0;

  const nftMetaByKey = useMemo(() => {
    const map = new Map<string, ZerionNftView>();
    for (const n of props.nfts) {
      const key = `nft:${n.chainId ?? ""}:${n.contract.toLowerCase()}:${n.tokenId}`;
      map.set(key, n);
    }
    return map;
  }, [props.nfts]);

  const verifiedTokenKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of props.positionsView?.groups ?? []) {
      for (const row of g.rows ?? []) {
        if (row.isVerified === false) continue;
        if (!row.chainId) continue;
        if (row.standard === "native") {
          keys.add(`native:${row.chainId}`);
          continue;
        }
        if (row.standard === "erc20" && row.contract) {
          keys.add(`erc20:${row.chainId}:${row.contract.toLowerCase()}`);
        }
      }
    }
    return keys;
  }, [props.positionsView]);

  const portfolioTokenKeys = useMemo(() => {
    // All token keys present in the portfolio view (verified or unverified).
    const keys = new Set<string>();
    for (const g of props.positionsView?.groups ?? []) {
      for (const row of g.rows ?? []) {
        if (!row.chainId) continue;
        if (row.standard === "native") {
          keys.add(`native:${row.chainId}`);
          continue;
        }
        if (row.standard === "erc20" && row.contract) {
          keys.add(`erc20:${row.chainId}:${row.contract.toLowerCase()}`);
        }
      }
    }
    return keys;
  }, [props.positionsView]);

  const unverifiedTokenIndexes = useMemo(() => {
    // Tokens that we can transfer (in `assets`) but that don't show up in Zerion's *verified* portfolio view.
    // These are typically low-value/zero-value, missing metadata, or filtered as non-displayable.
    if (!props.positionsView) return [];
    return tokenIndexes.filter(i => !verifiedTokenKeys.has(assetKey(props.assets[i])));
  }, [props.assets, props.positionsView, tokenIndexes, verifiedTokenKeys]);

  const missingFromPortfolioTokenIndexes = useMemo(() => {
    // Tokens present in `assets` but missing from the portfolio view entirely.
    // When "Show unverified assets" is enabled, we inject these into the portfolio table UI.
    if (!props.positionsView) return [];
    return tokenIndexes.filter(i => !portfolioTokenKeys.has(assetKey(props.assets[i])));
  }, [portfolioTokenKeys, props.assets, props.positionsView, tokenIndexes]);

  const positionsViewWithInjectedUnverified = useMemo((): ZerionPositionsView | null => {
    if (!props.positionsView) return null;
    if (!showUnverified) return props.positionsView;
    if (!missingFromPortfolioTokenIndexes.length) return props.positionsView;

    const walletGroupId = "wallet";
    const groups = props.positionsView.groups ?? [];
    const existingWallet = groups.find(g => g.id === walletGroupId);

    const injectedRows = missingFromPortfolioTokenIndexes.map((i, n) => {
      const a = props.assets[i];
      const chainId = a.chainId;
      const standard: "native" | "erc20" = a.standard === "native" ? "native" : "erc20";
      const contract = a.standard === "erc20" ? a.contract : undefined;
      const amountInt = a.amount ?? "0";
      const quantityText = a.standard === "native" ? `${amountInt} (raw)` : `${amountInt} (raw)`;
      return {
        id: `injected:${assetKey(a)}:${n}`,
        chain: String(chainId),
        chainId,
        standard,
        isVerified: false,
        tokenName: a.standard === "native" ? "Native token" : "Token",
        tokenSymbol: "",
        tokenIconUrl: undefined,
        contract,
        kind: "wallet" as const,
        quantityText,
        amountInt,
        valueUsd: 0,
        signedValueUsd: 0,
      };
    });

    const nextWallet = existingWallet
      ? { ...existingWallet, rows: [...(existingWallet.rows ?? []), ...injectedRows] }
      : {
          id: walletGroupId,
          title: "Wallet",
          iconUrl: undefined,
          url: undefined,
          totalValueUsd: 0,
          percentOfPortfolio: 0,
          rows: injectedRows,
        };

    const nextGroups = existingWallet
      ? groups.map(g => (g.id === walletGroupId ? nextWallet : g))
      : [nextWallet, ...groups];

    return {
      ...props.positionsView,
      groups: nextGroups,
    };
  }, [missingFromPortfolioTokenIndexes, props.assets, props.positionsView, showUnverified]);

  const positionsViewForDisplay = useMemo((): ZerionPositionsView | null => {
    const base = positionsViewWithInjectedUnverified ?? props.positionsView;
    if (!base) return null;

    const tokenKeyForRow = (row: any): string | null => {
      const chainId = typeof row?.chainId === "number" ? row.chainId : Number(row?.chainId);
      if (!Number.isFinite(chainId)) return null;
      const std = row?.standard;
      if (std === "native") return `native:${chainId}`;
      const c = typeof row?.contract === "string" ? row.contract : null;
      if (std === "erc20" && c) return `erc20:${chainId}:${c.toLowerCase()}`;
      return null;
    };

    // Patch wallet rows with exact onchain balances (Zerion can be rounded/stale).
    return {
      ...base,
      groups: (base.groups ?? []).map(g => {
        if (g.id !== "wallet") return g;
        return {
          ...g,
          rows: (g.rows ?? []).map(r => {
            const key = tokenKeyForRow(r);
            const info = key ? onchainTokenInfoByKey[key] : null;
            if (!key || !info) return r;
            return {
              ...r,
              amountInt: info.balanceWei,
              quantityDecimals: info.decimals,
              quantityNumeric: info.formatted,
              quantityText: r.tokenSymbol ? `${info.formatted} ${r.tokenSymbol}` : info.formatted,
            };
          }),
        };
      }),
    };
  }, [onchainTokenInfoByKey, positionsViewWithInjectedUnverified, props.positionsView]);

  const { walletPositionsView, protocolPositionsView } = useMemo(() => {
    const pv = positionsViewForDisplay ?? positionsViewWithInjectedUnverified ?? props.positionsView;
    if (!pv)
      return {
        walletPositionsView: null as ZerionPositionsView | null,
        protocolPositionsView: null as ZerionPositionsView | null,
      };

    const groups = Array.isArray(pv.groups) ? pv.groups : [];
    const walletGroup = groups.find(g => g.id === "wallet") ?? null;
    const protocolGroups = groups.filter(g => g.id !== "wallet");

    return {
      walletPositionsView: walletGroup
        ? ({
            totalValueUsd: Math.max(walletGroup.totalValueUsd ?? 0, 0),
            groups: [walletGroup],
          } satisfies ZerionPositionsView)
        : null,
      protocolPositionsView: protocolGroups.length
        ? ({
            totalValueUsd: pv.totalValueUsd ?? 0,
            groups: protocolGroups,
          } satisfies ZerionPositionsView)
        : null,
    };
  }, [positionsViewForDisplay, positionsViewWithInjectedUnverified, props.positionsView]);

  const unverifiedNftIndexes = useMemo(() => {
    // NFTs present in `assets` but missing metadata in `nfts` view.
    return nftIndexes.filter(i => {
      const a = props.assets[i];
      const metaKey = `nft:${a.chainId}:${a.contract.toLowerCase()}:${a.tokenId ?? ""}`;
      return !nftMetaByKey.has(metaKey);
    });
  }, [nftIndexes, nftMetaByKey, props.assets]);

  const chainLabel = (chain: string) => (chain ? chain.charAt(0).toUpperCase() + chain.slice(1) : "Unknown");

  const [customDraft, setCustomDraft] = useState<{
    chainId: number;
    contract: string;
    // When ABI is found, user selects a method from ABI:
    selectedAbiSig: string;
    // When ABI is not found, user enters a signature manually:
    functionSignature: string;
    // Raw inputs (strings). Address params can use:
    // - "$SAFE" or "$COMPROMISED" sentinels (server substitutes)
    args: string[];
    // Wei (base-10 string). Keep string to avoid bigint serialization issues.
    valueWei: string;
    // Raw tx/call input (hex).
    rawTxHex: string;
    rawDataHex: string;
    rawValueWei: string;
  }>(() => {
    const preferredChainId =
      props.assets.find(a => supportedChainIds.has(a.chainId))?.chainId ??
      sortNetworksForDropdown(
        Array.from(supportedChainIds.values()).map(id => ({ id, name: getTargetNetworkById(id)?.name })),
      ).map(x => x.id)[0] ??
      1;
    return {
      chainId: preferredChainId,
      contract: "",
      selectedAbiSig: "",
      functionSignature: "",
      args: [],
      valueWei: "0",
      rawTxHex: "",
      rawDataHex: "",
      rawValueWei: "0",
    };
  });
  const [customStatus, setCustomStatus] = useState<string | null>(null);

  const contractAddress = useMemo(() => {
    try {
      const raw = customDraft.contract.trim();
      if (!raw || !isAddress(raw)) return null;
      return getAddress(raw) as Address;
    } catch {
      return null;
    }
  }, [customDraft.contract]);

  const rawParsed = useMemo(() => {
    const raw = customDraft.rawTxHex.trim();
    if (!raw) return { ok: false as const, kind: "empty" as const };
    if (!raw.startsWith("0x"))
      return { ok: false as const, kind: "invalid" as const, error: "Must be 0x-prefixed hex" };
    try {
      const tx: any = parseTransaction(raw as Hex);
      // tx.to can be undefined for contract creation; require a `to` for our delegate call.
      const to = typeof tx?.to === "string" && isAddress(tx.to) ? (getAddress(tx.to) as Address) : null;
      const data = typeof tx?.data === "string" && tx.data.startsWith("0x") ? (tx.data as Hex) : null;
      const valueWei = typeof tx?.value === "bigint" ? tx.value.toString() : "0";
      return { ok: true as const, kind: "tx" as const, to, data, valueWei };
    } catch {
      // Not a full tx. Could be calldata.
      return { ok: true as const, kind: "calldata" as const, data: raw as Hex };
    }
  }, [customDraft.rawTxHex]);

  const rawToFromTx = useMemo(() => {
    return rawParsed.ok && rawParsed.kind === "tx" ? rawParsed.to : null;
  }, [rawParsed]);

  // Auto-populate contract address from raw tx `to` when available, but don't override a user's manual override.
  const lastAutoToRef = useRef<Address | null>(null);
  useEffect(() => {
    if (customAddTab !== "raw") return;
    if (!rawToFromTx) {
      lastAutoToRef.current = null;
      return;
    }
    const prevAuto = lastAutoToRef.current;
    setCustomDraft(d => {
      const cur = String(d.contract ?? "").trim();
      const shouldOverwrite =
        !cur || (prevAuto && cur.toLowerCase?.() === prevAuto.toLowerCase?.()) || cur === prevAuto;
      return shouldOverwrite ? { ...d, contract: rawToFromTx } : d;
    });
    lastAutoToRef.current = rawToFromTx;
  }, [customAddTab, rawToFromTx]);

  const {
    contractData,
    error: contractAbiError,
    isLoading: contractAbiLoading,
  } = useFetchContractAbi({
    contractAddress: customDraft.contract,
    chainId: customDraft.chainId,
    disabled: customAddTab === "raw" || !supportedChainIds.has(customDraft.chainId),
  });

  const abiUi = useMemo(() => {
    const chainOk = supportedChainIds.has(customDraft.chainId);
    const addrOk = Boolean(contractAddress);
    if (!chainOk || !addrOk)
      return { status: "idle" as const, abi: null as any[] | null, message: undefined as string | undefined };
    if (contractAbiLoading)
      return { status: "loading" as const, abi: null as any[] | null, message: undefined as string | undefined };
    const abi = Array.isArray(contractData?.abi) ? (contractData?.abi as any[]) : null;
    if (abi) return { status: "found" as const, abi, message: undefined as string | undefined };
    const dataMsg =
      typeof (contractData as any)?.message === "string" ? String((contractData as any)?.message) : undefined;
    if (dataMsg) return { status: "notfound" as const, abi: null as any[] | null, message: dataMsg };
    const msg =
      contractAbiError instanceof Error
        ? contractAbiError.message
        : typeof contractAbiError === "string"
          ? contractAbiError
          : contractAbiError
            ? String(contractAbiError)
            : undefined;
    return { status: msg ? ("error" as const) : ("notfound" as const), abi: null as any[] | null, message: msg };
  }, [contractAbiError, contractAbiLoading, contractAddress, contractData, customDraft.chainId, supportedChainIds]);

  const writeMethods = useMemo(() => {
    if (abiUi.status !== "found" || !abiUi.abi) return [];
    return abiUi.abi
      .filter(isWriteFunction)
      .map(fn => {
        const sig = functionSignatureFromAbi(fn);
        if (!sig) return null;
        const inputs = Array.isArray(fn.inputs) ? fn.inputs : [];
        const stateMutability = String(fn.stateMutability ?? "");
        const label = `${sig}${stateMutability === "payable" ? " (payable)" : ""}`;
        return { sig, label, inputs, stateMutability };
      })
      .filter((x): x is { sig: string; label: string; inputs: any[]; stateMutability: string } => Boolean(x))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [abiUi.abi, abiUi.status]);

  const selectedMethod = useMemo(() => {
    const sig = customDraft.selectedAbiSig.trim();
    if (!sig) return null;
    return writeMethods.find(m => m.sig === sig) ?? null;
  }, [customDraft.selectedAbiSig, writeMethods]);

  const signatureMode = abiUi.status !== "found" || writeMethods.length === 0;
  const activeSignature = signatureMode ? customDraft.functionSignature.trim() : (selectedMethod?.sig ?? "");

  const parsedActiveInputs = useMemo(() => {
    if (!activeSignature) return { ok: false as const, error: "Select a method or enter a signature." };
    try {
      const sig = activeSignature.startsWith("function ")
        ? activeSignature.slice("function ".length).trim()
        : activeSignature;
      const abi = parseAbi([`function ${sig}`] as unknown as readonly string[]) as any[];
      const fn = (abi.find((x: any) => x?.type === "function") ?? null) as any;
      const inputs = Array.isArray(fn?.inputs) ? fn.inputs : [];
      return { ok: true as const, inputs };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Invalid signature" };
    }
  }, [activeSignature]);

  // Keep args array sized to the active signature inputs.
  useEffect(() => {
    if (!parsedActiveInputs.ok) return;
    const expected = parsedActiveInputs.inputs.length;
    setCustomDraft(d => {
      if (d.args.length === expected) return d;
      const next = Array.from({ length: expected }, (_, i) => String(d.args[i] ?? ""));
      return { ...d, args: next };
    });
  }, [parsedActiveInputs]);

  // If user picks an ABI method, clear manual signature; if they type a signature, clear selected ABI method.
  useEffect(() => {
    if (!customDraft.selectedAbiSig.trim()) return;
    setCustomDraft(d => (d.functionSignature ? { ...d, functionSignature: "" } : d));
  }, [customDraft.selectedAbiSig]);

  useEffect(() => {
    if (!customDraft.functionSignature.trim()) return;
    setCustomDraft(d => (d.selectedAbiSig ? { ...d, selectedAbiSig: "" } : d));
  }, [customDraft.functionSignature]);

  const customErrorsBlocking = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!supportedChainIds.has(customDraft.chainId)) errs.chainId = "Unsupported network";

    const addr = contractAddress;
    if (customAddTab === "raw") {
      const toFromTx = rawParsed.ok && rawParsed.kind === "tx" ? rawParsed.to : null;
      if (!toFromTx) {
        if (!customDraft.contract.trim()) errs.contract = "Required";
        else if (!addr) errs.contract = "Invalid address";
        else if (addr.toLowerCase() === "0x0000000000000000000000000000000000000000") errs.contract = "Zero address";
      }
    } else {
      if (!customDraft.contract.trim()) errs.contract = "Required";
      else if (!addr) errs.contract = "Invalid address";
      else if (addr.toLowerCase() === "0x0000000000000000000000000000000000000000") errs.contract = "Zero address";
    }

    if (customAddTab !== "raw") {
      if (!activeSignature) errs.functionSignature = "Required";
      else if (!parsedActiveInputs.ok) errs.functionSignature = parsedActiveInputs.error;

      if (parsedActiveInputs.ok) {
        const expected = parsedActiveInputs.inputs.length;
        if (customDraft.args.length !== expected) errs.args = `Missing inputs (expected ${expected})`;
        for (let i = 0; i < expected; i++) {
          const t = String((parsedActiveInputs.inputs[i] as any)?.type ?? "");
          const v = String(customDraft.args[i] ?? "").trim();
          if (t === "address" && v && v !== "$SAFE" && v !== "$COMPROMISED" && !isAddress(v)) {
            errs[`arg_${i}`] = "Invalid address";
          }
        }
      }
    }

    if (customAddTab === "raw") {
      const raw = customDraft.rawTxHex.trim();
      if (!raw) errs.rawTxHex = "Required";
      else if (!raw.startsWith("0x")) errs.rawTxHex = "Must be 0x-prefixed hex";

      const derivedData =
        rawParsed.ok && rawParsed.kind === "tx"
          ? rawParsed.data
          : rawParsed.ok && rawParsed.kind === "calldata"
            ? rawParsed.data
            : null;
      if (!derivedData) errs.rawTxHex = errs.rawTxHex ?? "Could not parse tx/call data";

      const toFromTx = rawParsed.ok && rawParsed.kind === "tx" ? rawParsed.to : null;
      const to = toFromTx ?? contractAddress;
      if (!to) errs.contract = "Required";

      const v = String(customDraft.rawValueWei ?? "").trim();
      if (v && !/^\d+$/.test(v)) errs.rawValueWei = "Use a base-10 integer";
    }

    return errs;
  }, [
    customDraft.chainId,
    customDraft.contract,
    customDraft.args,
    customDraft.rawTxHex,
    customDraft.rawValueWei,
    supportedChainIds,
    contractAddress,
    activeSignature,
    parsedActiveInputs,
    customAddTab,
    rawParsed,
  ]);

  const customErrors = useMemo(() => {
    // Only show "Required" (and related empty-state errors) after user interaction,
    // but still block adding until required fields are present.
    const shown: Record<string, string> = {};
    const showContractRequired = customAttemptedAdd || customTouched.contract;
    const showSigRequired = customAttemptedAdd || customTouched.functionSignature;
    const showRawRequired = customAttemptedAdd || customTouched.rawTxHex;

    const hasContractInput = Boolean(customDraft.contract.trim());
    const hasSigInput = signatureMode
      ? Boolean(customDraft.functionSignature.trim())
      : Boolean(customDraft.selectedAbiSig.trim());
    const hasRawInput = Boolean(customDraft.rawTxHex.trim());

    for (const [k, v] of Object.entries(customErrorsBlocking)) {
      if (v === "Required") {
        if (k === "contract" && showContractRequired) shown[k] = v;
        else if (k === "functionSignature" && showSigRequired) shown[k] = v;
        else if (k === "rawTxHex" && showRawRequired) shown[k] = v;
        continue;
      }

      // Show parse/format errors once the user has provided input (or after an add attempt).
      if (k === "contract" && !(customAttemptedAdd || hasContractInput)) continue;
      if (k === "functionSignature" && !(customAttemptedAdd || hasSigInput)) continue;
      if (k === "rawTxHex" && !(customAttemptedAdd || hasRawInput)) continue;

      shown[k] = v;
    }

    return shown;
  }, [
    customErrorsBlocking,
    customAttemptedAdd,
    customTouched.contract,
    customTouched.functionSignature,
    customTouched.rawTxHex,
    customDraft.contract,
    customDraft.functionSignature,
    customDraft.selectedAbiSig,
    customDraft.rawTxHex,
    signatureMode,
  ]);

  const canAddCustom = Object.keys(customErrorsBlocking).length === 0;

  const resetCustomInputs = () => {
    setCustomDraft(d => ({
      ...d,
      contract: "",
      selectedAbiSig: "",
      functionSignature: "",
      args: [],
      valueWei: "0",
      rawTxHex: "",
      rawDataHex: "",
      rawValueWei: "0",
    }));
    setCustomAttemptedAdd(false);
    setCustomTouched({ contract: false, functionSignature: false, rawTxHex: false });
  };

  const addCustom = () => {
    setCustomStatus(null);
    if (!canAddCustom) {
      setCustomAttemptedAdd(true);
      return;
    }
    let nextAsset: RecoveryAsset;
    if (customAddTab === "raw") {
      const toFromTx = rawParsed.ok && rawParsed.kind === "tx" ? rawParsed.to : null;
      const contract =
        toFromTx ??
        (contractAddress
          ? (getAddress(contractAddress) as Address)
          : (getAddress(customDraft.contract.trim()) as Address));
      const dataHex =
        rawParsed.ok && rawParsed.kind === "tx"
          ? rawParsed.data
          : rawParsed.ok && rawParsed.kind === "calldata"
            ? rawParsed.data
            : null;
      nextAsset = {
        origin: "custom",
        chainId: customDraft.chainId,
        standard: "customcall",
        contract,
        dataHex: (dataHex ?? "0x") as Hex,
        valueWei: (() => {
          const typed = String(customDraft.rawValueWei ?? "").trim();
          if (typed) return typed;
          return rawParsed.ok && rawParsed.kind === "tx" ? rawParsed.valueWei : "0";
        })(),
      };
    } else {
      const contract = contractAddress
        ? (getAddress(contractAddress) as Address)
        : (getAddress(customDraft.contract.trim()) as Address);
      nextAsset = {
        origin: "custom",
        chainId: customDraft.chainId,
        standard: "customcall",
        contract,
        functionSignature: activeSignature,
        args: customDraft.args.map(v => String(v ?? "")),
        valueWei: String(customDraft.valueWei ?? "0").trim() || "0",
      };
    }

    const key = assetKey(nextAsset);
    const existing = indexByAssetKey.get(key);
    if (typeof existing === "number") {
      // Avoid duplicates (especially important for ERC-20, since the Tokens tab maps a token key to a single index).
      const nextSel = new Set(selectedSet);
      nextSel.add(existing);
      props.onChangeSelected(Array.from(nextSel).sort((a, b) => a - b));
      setCustomStatus("That asset is already in your list — selected the existing entry.");
      resetCustomInputs();
      return;
    }

    const nextAssets = [...props.assets, nextAsset];
    const addedIndex = nextAssets.length - 1;
    props.onChangeAssets(nextAssets);
    const nextSel = new Set(selectedSet);
    nextSel.add(addedIndex);
    props.onChangeSelected(Array.from(nextSel).sort((a, b) => a - b));
    setCustomStatus("Added and selected.");
    resetCustomInputs();
  };

  const removeAssetAtIndex = (idx: number) => {
    const nextAssets = props.assets.filter((_, i) => i !== idx);
    const nextSelected = props.selectedIndexes
      .filter(i => i !== idx)
      .map(i => (i > idx ? i - 1 : i))
      .sort((a, b) => a - b);
    props.onChangeAssets(nextAssets);
    props.onChangeSelected(nextSelected);
  };

  return (
    <div className="bg-base-100 rounded-3xl p-8 border border-base-300">
      <h2 className="text-2xl font-bold m-0">Select assets to recover</h2>
      <p className="mt-2 text-sm text-neutral">
        Choose what you want to move. We’ll execute the transfers in one sponsored transaction.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <div role="tablist" className="tabs tabs-boxed">
          <button role="tab" className={`tab ${tab === "tokens" ? "tab-active" : ""}`} onClick={() => setTab("tokens")}>
            Tokens{" "}
            {tokenSelectedCount > 0 ? (
              <span className="ml-2 text-xs font-bold text-base-content">({tokenSelectedCount})</span>
            ) : null}
          </button>
          <button role="tab" className={`tab ${tab === "nfts" ? "tab-active" : ""}`} onClick={() => setTab("nfts")}>
            NFTs{" "}
            {nftSelectedCount > 0 ? (
              <span className="ml-2 text-xs font-bold text-base-content">({nftSelectedCount})</span>
            ) : null}
          </button>
          <button role="tab" className={`tab ${tab === "custom" ? "tab-active" : ""}`} onClick={() => setTab("custom")}>
            Custom{" "}
            {customSelectedCount > 0 ? (
              <span className="ml-2 text-xs font-bold text-base-content">({customSelectedCount})</span>
            ) : null}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-neutral select-none">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={showUnverified}
              onChange={e => setShowUnverified(e.target.checked)}
            />
            Show unverified assets
          </label>
          <button className="btn btn-ghost btn-sm rounded-full" onClick={selectAllInTab}>
            Select all
          </button>
          <button className="btn btn-ghost btn-sm rounded-full" onClick={clearInTab}>
            Clear
          </button>
          <div className="text-xs text-neutral">{props.selectedIndexes.length} selected total</div>
        </div>
      </div>

      {tab === "tokens" ? (
        <div className="mt-4">
          {props.positionsView ? (
            <div className="space-y-3">
              {walletPositionsView ? (
                <>
                  <div className="text-xs text-neutral">
                    Wallet balances are shown using <span className="font-semibold">onchain</span> reads (Zerion data{" "}
                    can be stale/rounded).
                  </div>
                  <PositionsOverview
                    positionsView={walletPositionsView}
                    selectable
                    selectedKeys={selectedTokenKeys}
                    onToggleKey={toggleTokenKey}
                    showUnverified={showUnverified}
                    showGroupHeader={false}
                  />
                </>
              ) : (
                <div className="text-sm text-neutral">No wallet-held tokens found.</div>
              )}

              {protocolPositionsView ? (
                <div className="pt-2">
                  <div className="text-sm font-semibold">Positions</div>
                  <div className="text-xs text-neutral mt-1">
                    These are protocol positions. They may not be transferable as ERC-20 balances (unless you see the
                    underlying ERC-20s above).
                    <br /> You may need to{" "}
                    <a href="/recover/custom-calls" target="_blank" rel="noreferrer" className="link">
                      add a custom call
                    </a>{" "}
                    to unwind and transfer them.
                  </div>
                  <div className="mt-3">
                    <PositionsOverview
                      positionsView={protocolPositionsView}
                      showUnverified={showUnverified}
                      showGroupHeader
                    />
                  </div>
                </div>
              ) : null}

              {!showUnverified && unverifiedTokenIndexes.length ? (
                <div className="text-xs text-neutral">
                  {unverifiedTokenIndexes.length} unverified token{unverifiedTokenIndexes.length === 1 ? "" : "s"}{" "}
                  hidden — enable “Show unverified assets” to include.
                </div>
              ) : null}
            </div>
          ) : tokenIndexes.length ? (
            <div className="text-sm text-neutral">
              Token portfolio data unavailable; showing recoverable token transfers only.
            </div>
          ) : (
            <div className="text-sm text-neutral">No tokens found via Zerion for this address.</div>
          )}
        </div>
      ) : tab === "nfts" ? (
        <div className="mt-4">
          {nftIndexes.length === 0 ? (
            <div className="text-sm text-neutral">No NFTs found via Zerion for this address.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {nftIndexes
                .filter(i => {
                  if (showUnverified) return true;
                  // If the NFT metadata is missing, consider it "unverified" and hide by default.
                  const a = props.assets[i];
                  const metaKey = `nft:${a.chainId}:${a.contract.toLowerCase()}:${a.tokenId ?? ""}`;
                  return nftMetaByKey.has(metaKey);
                })
                .map(i => {
                  const asset = props.assets[i];
                  const selected = selectedSet.has(i);
                  const supported = supportedChainIds.has(asset.chainId);
                  const metaKey = `nft:${asset.chainId}:${asset.contract.toLowerCase()}:${asset.tokenId ?? ""}`;
                  const meta = nftMetaByKey.get(metaKey);

                  const title = meta?.name ?? (asset.standard === "erc721" ? "ERC-721 NFT" : "ERC-1155 NFT");
                  const collection = meta?.collectionName ?? "Unknown collection";
                  const imageUrl = meta?.imagePreviewUrl ?? meta?.imageDetailUrl ?? meta?.collectionIconUrl;
                  const network = meta?.chain ? chainLabel(meta.chain) : `chainId=${asset.chainId}`;
                  const subtitle =
                    asset.standard === "erc1155"
                      ? `${network} • ${collection} • #${asset.tokenId ?? "?"} • amount=${asset.amount ?? "0"}`
                      : `${network} • ${collection} • #${asset.tokenId ?? "?"}`;

                  return (
                    <button
                      type="button"
                      key={assetKey(asset)}
                      onClick={() => toggle(i)}
                      disabled={!supported}
                      className={`text-left rounded-3xl border p-4 transition ${
                        !supported
                          ? "border-base-300 bg-base-100 opacity-60 cursor-not-allowed"
                          : selected
                            ? "border-primary bg-primary/5"
                            : "border-base-300 bg-base-100 hover:bg-base-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-14 h-14 rounded-2xl bg-base-200 border border-base-300 overflow-hidden flex items-center justify-center shrink-0">
                            {imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded bg-base-300" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="font-semibold truncate">{title}</div>
                            <div className="text-xs text-neutral break-words mt-1">{subtitle}</div>
                            {typeof meta?.valueUsd === "number" && Number.isFinite(meta.valueUsd) ? (
                              <div className="text-xs text-neutral mt-1">≈ ${meta.valueUsd.toFixed(2)}</div>
                            ) : null}
                            {!supported ? (
                              <div className="text-xs text-warning mt-1">Unsupported network</div>
                            ) : !meta ? (
                              <div className="text-xs text-warning mt-1">Unverified (missing metadata)</div>
                            ) : null}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm mt-1"
                          checked={selected}
                          disabled={!supported}
                          readOnly
                        />
                      </div>
                    </button>
                  );
                })}
            </div>
          )}

          {!showUnverified && unverifiedNftIndexes.length ? (
            <div className="mt-3 text-xs text-neutral">
              {unverifiedNftIndexes.length} unverified NFT{unverifiedNftIndexes.length === 1 ? "" : "s"} hidden — enable
              “Show unverified assets” to include.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-3xl border border-base-300 bg-base-100 p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">Add a custom contract call</div>
                <div className="text-xs text-neutral mt-1">
                  Enter a contract address. If the contract is verified on a block explorer, we’ll list its write
                  methods and build inputs for you. If not, paste a function signature like{" "}
                  <span className="font-mono">transfer(address,uint256)</span>.
                </div>
              </div>
              <div role="tablist" className="tabs tabs-boxed">
                <button
                  type="button"
                  role="tab"
                  className={`tab ${customAddTab === "signature" ? "tab-active" : ""}`}
                  onClick={() => {
                    setCustomAddTab("signature");
                    setCustomAttemptedAdd(false);
                    setCustomTouched({ contract: false, functionSignature: false, rawTxHex: false });
                  }}
                >
                  Function / ABI
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`tab ${customAddTab === "raw" ? "tab-active" : ""}`}
                  onClick={() => {
                    setCustomAddTab("raw");
                    setCustomAttemptedAdd(false);
                    setCustomTouched({ contract: false, functionSignature: false, rawTxHex: false });
                  }}
                >
                  Raw tx
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="space-y-1">
                <div className="text-xs font-semibold">Chain</div>
                <select
                  className={`select select-bordered select-sm w-full ${customErrors.chainId ? "select-error" : ""}`}
                  value={String(customDraft.chainId)}
                  onChange={e =>
                    setCustomDraft(d => ({
                      ...d,
                      chainId: Number(e.target.value),
                      ...(customAddTab === "signature"
                        ? { selectedAbiSig: "", functionSignature: "", args: [] }
                        : { rawTxHex: "", rawDataHex: "", rawValueWei: "0" }),
                    }))
                  }
                >
                  {sortNetworksForDropdown(
                    Array.from(supportedChainIds.values()).map(id => ({ id, name: getTargetNetworkById(id)?.name })),
                  ).map(({ id }) => (
                    <option key={String(id)} value={String(id)}>
                      {getTargetNetworkById(id)?.name ?? `chainId=${id}`}
                    </option>
                  ))}
                </select>
                {customErrors.chainId ? <div className="text-[11px] text-error">{customErrors.chainId}</div> : null}
              </div>

              <div className="md:col-span-5 space-y-1">
                <div className="text-xs font-semibold flex items-center justify-between gap-2">
                  <span>Contract</span>
                  <span className={`text-[11px] font-normal ${customErrors.contract ? "text-error" : "text-neutral"}`}>
                    Required
                  </span>
                </div>
                <AddressInput
                  placeholder="0x…"
                  value={customDraft.contract}
                  onChange={v => {
                    setCustomTouched(t => (t.contract ? t : { ...t, contract: true }));
                    // If the user manually edits the contract in raw mode, treat it as an override.
                    if (customAddTab === "raw") lastAutoToRef.current = null;
                    setCustomDraft(d => ({
                      ...d,
                      contract: v,
                      ...(customAddTab === "signature"
                        ? {
                            selectedAbiSig: "",
                            functionSignature: "",
                            args: [],
                          }
                        : {}),
                    }));
                  }}
                />
                {customErrors.contract ? <div className="text-[11px] text-error">{customErrors.contract}</div> : null}
              </div>
            </div>

            {customAddTab === "signature" ? (
              <>
                <div className="mt-3 text-xs text-neutral">
                  {abiUi.status === "idle" ? null : abiUi.status === "loading" ? (
                    <>Looking up verified ABI…</>
                  ) : abiUi.status === "found" ? (
                    <>
                      ABI found. {writeMethods.length} write method{writeMethods.length === 1 ? "" : "s"} detected.
                    </>
                  ) : abiUi.status === "notfound" ? (
                    <>
                      No verified ABI found{abiUi.message ? <>: {abiUi.message}</> : null}. You can still continue using{" "}
                      a function signature.
                    </>
                  ) : (
                    <>ABI lookup error: {abiUi.message}</>
                  )}
                </div>

                {!signatureMode && writeMethods.length ? (
                  <div className="mt-4 space-y-1">
                    <div className="text-xs font-semibold flex items-center justify-between gap-2">
                      <span>Write method</span>
                      <span
                        className={`text-[11px] font-normal ${customErrors.functionSignature ? "text-error" : "text-neutral"}`}
                      >
                        Required
                      </span>
                    </div>
                    <select
                      className={`select select-bordered select-sm w-full ${customErrors.functionSignature ? "select-error" : ""}`}
                      value={customDraft.selectedAbiSig}
                      onChange={e => {
                        setCustomTouched(t => (t.functionSignature ? t : { ...t, functionSignature: true }));
                        setCustomDraft(d => ({ ...d, selectedAbiSig: e.target.value }));
                      }}
                    >
                      <option value="">Select a method…</option>
                      {writeMethods.map(m => (
                        <option key={m.sig} value={m.sig}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    {customErrors.functionSignature ? (
                      <div className="text-[11px] text-error">{customErrors.functionSignature}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 space-y-1">
                    <div className="text-xs font-semibold flex items-center justify-between gap-2">
                      <span>Function signature</span>
                      <span
                        className={`text-[11px] font-normal ${customErrors.functionSignature ? "text-error" : "text-neutral"}`}
                      >
                        Required
                      </span>
                    </div>
                    <input
                      className={`input input-bordered input-sm w-full ${customErrors.functionSignature ? "input-error" : ""}`}
                      value={customDraft.functionSignature}
                      onChange={e => {
                        setCustomTouched(t => (t.functionSignature ? t : { ...t, functionSignature: true }));
                        setCustomDraft(d => ({ ...d, functionSignature: e.target.value }));
                      }}
                      placeholder="e.g. transfer(address,uint256)"
                    />
                    {customErrors.functionSignature ? (
                      <div className="text-[11px] text-error">{customErrors.functionSignature}</div>
                    ) : (
                      <div className="text-[11px] text-neutral">
                        Tip: for address params, you can use <span className="font-mono">$SAFE</span> or{" "}
                        <span className="font-mono">$COMPROMISED</span>.
                      </div>
                    )}
                  </div>
                )}

                {parsedActiveInputs.ok ? (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold">Inputs</div>
                    {parsedActiveInputs.inputs.length === 0 ? (
                      <div className="text-xs text-neutral">This method has no parameters.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {parsedActiveInputs.inputs.map((inp: any, idx: number) => {
                          const t = String(inp?.type ?? "");
                          const n = String(inp?.name ?? `arg${idx}`);
                          const raw = String(customDraft.args[idx] ?? "");
                          const err = customErrors[`arg_${idx}`];
                          const isAddr = t === "address";
                          const isBool = t === "bool";
                          const isComplex = t.endsWith("[]") || t.includes("tuple");
                          const addrMode = raw === "$SAFE" ? "safe" : raw === "$COMPROMISED" ? "compromised" : "custom";

                          return (
                            <div key={`${n}:${idx}`} className="space-y-1">
                              <div className="text-[11px] font-semibold">
                                {n} <span className="text-neutral font-normal">({t})</span>
                              </div>

                              {isAddr ? (
                                <div className="flex gap-2 items-center">
                                  <select
                                    className="select select-bordered select-sm w-44"
                                    value={addrMode}
                                    onChange={e => {
                                      const mode = e.target.value;
                                      setCustomDraft(d => {
                                        const next = [...d.args];
                                        next[idx] =
                                          mode === "safe" ? "$SAFE" : mode === "compromised" ? "$COMPROMISED" : "";
                                        return { ...d, args: next };
                                      });
                                    }}
                                  >
                                    <option value="custom">Custom</option>
                                    <option value="safe">Recovery address</option>
                                    <option value="compromised">Compromised address</option>
                                  </select>
                                  {addrMode === "custom" ? (
                                    <div className="flex-1 min-w-0">
                                      <AddressInput
                                        placeholder="0x…"
                                        value={raw}
                                        onChange={v =>
                                          setCustomDraft(d => {
                                            const next = [...d.args];
                                            next[idx] = v;
                                            return { ...d, args: next };
                                          })
                                        }
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-xs text-neutral font-mono">{raw}</div>
                                  )}
                                </div>
                              ) : isBool ? (
                                <select
                                  className={`select select-bordered select-sm w-full ${err ? "select-error" : ""}`}
                                  value={
                                    raw.trim().toLowerCase() === "true"
                                      ? "true"
                                      : raw.trim().toLowerCase() === "false"
                                        ? "false"
                                        : ""
                                  }
                                  onChange={e =>
                                    setCustomDraft(d => {
                                      const next = [...d.args];
                                      next[idx] = e.target.value;
                                      return { ...d, args: next };
                                    })
                                  }
                                >
                                  <option value="">Select…</option>
                                  <option value="true">true</option>
                                  <option value="false">false</option>
                                </select>
                              ) : isComplex ? (
                                <textarea
                                  className={`textarea textarea-bordered textarea-sm w-full ${err ? "textarea-error" : ""}`}
                                  rows={3}
                                  value={raw}
                                  onChange={e =>
                                    setCustomDraft(d => {
                                      const next = [...d.args];
                                      next[idx] = e.target.value;
                                      return { ...d, args: next };
                                    })
                                  }
                                  placeholder='JSON (e.g. ["0x…","0x…"] or {"a":1})'
                                />
                              ) : (
                                <input
                                  className={`input input-bordered input-sm w-full ${err ? "input-error" : ""}`}
                                  value={raw}
                                  onChange={e =>
                                    setCustomDraft(d => {
                                      const next = [...d.args];
                                      next[idx] = e.target.value;
                                      return { ...d, args: next };
                                    })
                                  }
                                  placeholder={t.startsWith("uint") || t.startsWith("int") ? "e.g. 123 or 0x7b" : ""}
                                />
                              )}

                              {err ? <div className="text-[11px] text-error">{err}</div> : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">Value (wei)</div>
                    <input
                      className="input input-bordered input-sm w-full"
                      value={customDraft.valueWei}
                      onChange={e => setCustomDraft(d => ({ ...d, valueWei: e.target.value }))}
                      placeholder="0"
                    />
                    <div className="text-[11px] text-neutral">Leave as 0 for non-payable calls.</div>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button className="btn btn-primary btn-sm rounded-full" onClick={addCustom}>
                    Add call
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-1">
                  <div className="text-xs font-semibold">Raw tx (hex)</div>
                  <textarea
                    className={`textarea textarea-bordered textarea-sm w-full ${customErrors.rawTxHex ? "textarea-error" : ""}`}
                    rows={4}
                    value={customDraft.rawTxHex}
                    onChange={e => {
                      setCustomTouched(t => (t.rawTxHex ? t : { ...t, rawTxHex: true }));
                      setCustomDraft(d => ({ ...d, rawTxHex: e.target.value }));
                    }}
                    placeholder="Paste a raw signed transaction (0x...) or just calldata (0x...)"
                  />
                  {customErrors.rawTxHex ? <div className="text-[11px] text-error">{customErrors.rawTxHex}</div> : null}
                  <div className="text-[11px] text-neutral">
                    If you paste a full raw tx, we’ll extract <span className="font-mono">to</span>,{" "}
                    <span className="font-mono">data</span>, and <span className="font-mono">value</span>. If you paste
                    calldata only, we’ll use the Contract field above as <span className="font-mono">to</span>.
                  </div>
                </div>

                {rawParsed.ok && rawParsed.kind === "tx" ? (
                  <div className="mt-3 text-xs text-neutral">
                    Parsed tx:{" "}
                    <span className="font-mono">
                      to={rawParsed.to ?? "—"} data={(rawParsed.data ?? "—").slice(0, 18)}
                      {rawParsed.data && rawParsed.data.length > 18 ? "…" : ""} valueWei={rawParsed.valueWei}
                    </span>
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">Value (wei)</div>
                    <input
                      className={`input input-bordered input-sm w-full ${customErrors.rawValueWei ? "input-error" : ""}`}
                      value={customDraft.rawValueWei}
                      onChange={e => setCustomDraft(d => ({ ...d, rawValueWei: e.target.value }))}
                      placeholder={rawParsed.ok && rawParsed.kind === "tx" ? rawParsed.valueWei : "0"}
                    />
                    {customErrors.rawValueWei ? (
                      <div className="text-[11px] text-error">{customErrors.rawValueWei}</div>
                    ) : (
                      <div className="text-[11px] text-neutral">Leave empty to use the tx’s value (or 0).</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button className="btn btn-primary btn-sm rounded-full" onClick={addCustom}>
                    Add call
                  </button>
                </div>
              </>
            )}

            {customStatus ? <div className="mt-3 text-xs text-neutral">{customStatus}</div> : null}
          </div>

          <div className="rounded-3xl border border-base-300 bg-base-100 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">Custom calls</div>
              <div className="text-xs text-neutral">{customIndexes.length} total</div>
            </div>

            {customIndexes.length === 0 ? (
              <div className="mt-3 text-sm text-neutral">No custom calls yet.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {customIndexes.map(i => {
                  const a = props.assets[i];
                  const selected = selectedSet.has(i);
                  const supported = supportedChainIds.has(a.chainId);
                  const chainName = getTargetNetworkById(a.chainId)?.name ?? `chainId=${a.chainId}`;
                  const label =
                    a.standard === "customcall"
                      ? "Contract call"
                      : a.standard === "erc20"
                        ? "ERC-20"
                        : a.standard === "erc721"
                          ? "ERC-721"
                          : a.standard === "erc1155"
                            ? "ERC-1155"
                            : "Native";
                  const details =
                    a.standard === "customcall"
                      ? a.dataHex
                        ? `rawTx • data=${String(a.dataHex).slice(0, 18)}${
                            String(a.dataHex).length > 18 ? "…" : ""
                          } • valueWei=${a.valueWei ?? "0"}`
                        : `${(a.functionSignature ?? "").trim() || "(signature)"} • args=${
                            Array.isArray(a.args) ? a.args.length : 0
                          } • valueWei=${a.valueWei ?? "0"}`
                      : a.standard === "erc20"
                        ? `amount=${a.amount ?? "0"}`
                        : a.standard === "erc721"
                          ? `tokenId=${a.tokenId ?? "?"}`
                          : a.standard === "erc1155"
                            ? `tokenId=${a.tokenId ?? "?"} • amount=${a.amount ?? "0"}`
                            : "";

                  return (
                    <div
                      key={`${assetKey(a)}:${i}`}
                      className={`rounded-2xl border p-4 ${
                        !supported
                          ? "border-base-300 bg-base-100 opacity-60"
                          : selected
                            ? "border-primary bg-primary/5"
                            : "border-base-300 bg-base-100"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <button
                          type="button"
                          className="text-left flex-1 min-w-[240px]"
                          onClick={() => toggle(i)}
                          disabled={!supported}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold">
                                {label} <span className="text-xs text-neutral">({chainName})</span>
                              </div>
                              <div className="text-xs text-neutral break-words mt-1">
                                <span className="font-mono">{a.contract}</span>
                              </div>
                              {details ? <div className="text-xs text-neutral mt-1">{details}</div> : null}
                              {!supported ? <div className="text-xs text-warning mt-1">Unsupported network</div> : null}
                            </div>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm mt-1"
                              checked={selected}
                              disabled={!supported}
                              readOnly
                            />
                          </div>
                        </button>

                        <button className="btn btn-ghost btn-xs rounded-full" onClick={() => removeAssetAtIndex(i)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-between">
        <button className="btn btn-ghost rounded-full" onClick={props.onBack}>
          Back
        </button>
        <button className="btn btn-primary rounded-full" onClick={props.onNext} disabled={!canNext}>
          Continue
        </button>
      </div>
    </div>
  );
}
