"use client";

import { useMemo, useState } from "react";
import type { RecoveryAsset } from "./types";
import { AddressInput } from "@scaffold-ui/components";
import type { Address } from "viem";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";

const emptyAsset = (chainId: number): RecoveryAsset => ({
  chainId,
  standard: "erc20",
  contract: "0x0000000000000000000000000000000000000000",
  amount: "0",
});

export function Triage(props: {
  compromisedAddress?: Address;
  safeAddress?: Address;
  assets: RecoveryAsset[];
  onChange: (next: { compromisedAddress?: Address; safeAddress?: Address; assets: RecoveryAsset[] }) => void;
  onNext: () => void;
}) {
  const { targetNetwork } = useTargetNetwork();
  const defaultChainId = targetNetwork?.id ?? scaffoldConfig.targetNetworks[0]?.id ?? 1;

  const [loadingScan, setLoadingScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const canScan = Boolean(props.compromisedAddress);

  const addRow = () => props.onChange({ ...props, assets: [...props.assets, emptyAsset(defaultChainId)] });

  const removeRow = (idx: number) => props.onChange({ ...props, assets: props.assets.filter((_, i) => i !== idx) });

  const updateRow = (idx: number, patch: Partial<RecoveryAsset>) =>
    props.onChange({
      ...props,
      assets: props.assets.map((a, i) => (i === idx ? ({ ...a, ...patch } as RecoveryAsset) : a)),
    });

  const totalRows = props.assets.length;

  const scan = async () => {
    if (!props.compromisedAddress) return;
    setLoadingScan(true);
    setScanError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          compromisedAddress: props.compromisedAddress,
          chainIds: [defaultChainId],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      props.onChange({
        compromisedAddress: props.compromisedAddress,
        safeAddress: props.safeAddress,
        assets: Array.isArray(json?.assets) ? json.assets : [],
      });
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoadingScan(false);
    }
  };

  const canNext = Boolean(props.compromisedAddress && props.safeAddress);

  const networkLabel = useMemo(() => {
    if (!targetNetwork) return `Chain ${defaultChainId}`;
    return `${targetNetwork.name} (${targetNetwork.id})`;
  }, [defaultChainId, targetNetwork]);

  return (
    <div className="space-y-4">
      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300">
        <h2 className="text-xl font-bold mb-2">1) Triage</h2>
        <p className="text-sm text-neutral mb-4">
          Enter the compromised wallet and the destination safe wallet. We’ll scan (or you can manually add) assets on{" "}
          <span className="font-medium">{networkLabel}</span>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Compromised address</div>
            <AddressInput
              placeholder="0x…"
              value={props.compromisedAddress ?? ""}
              onChange={v => props.onChange({ ...props, compromisedAddress: (v || undefined) as Address | undefined })}
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold">Safe address</div>
            <AddressInput
              placeholder="0x…"
              value={props.safeAddress ?? ""}
              onChange={v => props.onChange({ ...props, safeAddress: (v || undefined) as Address | undefined })}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm rounded-full" onClick={scan} disabled={!canScan || loadingScan}>
            {loadingScan ? <span className="loading loading-spinner loading-sm" /> : null}
            Scan via /api/scan
          </button>
          <button className="btn btn-ghost btn-sm rounded-full" onClick={addRow}>
            Add asset manually
          </button>
        </div>

        {scanError ? <div className="mt-3 text-sm text-error break-words">{scanError}</div> : null}
      </div>

      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Assets ({totalRows})</h3>
          <div className="text-xs text-neutral">MVP: local-only; scanning may be empty.</div>
        </div>

        {totalRows === 0 ? (
          <div className="mt-3 text-sm text-neutral">No assets yet. Use “Scan” or “Add asset manually”.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {props.assets.map((asset, idx) => (
              <div key={idx} className="rounded-2xl border border-base-300 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">ChainId</div>
                    <input
                      className="input input-bordered input-sm w-full"
                      value={String(asset.chainId)}
                      onChange={e => updateRow(idx, { chainId: Number(e.target.value || defaultChainId) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">Standard</div>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={asset.standard}
                      onChange={e => updateRow(idx, { standard: e.target.value as RecoveryAsset["standard"] })}
                    >
                      <option value="erc20">ERC-20</option>
                      <option value="erc721">ERC-721</option>
                      <option value="erc1155">ERC-1155</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <div className="text-xs font-semibold">Token contract</div>
                    <AddressInput
                      placeholder="0x…"
                      value={asset.contract}
                      onChange={v => updateRow(idx, { contract: v as Address })}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">
                      {asset.standard === "erc721" ? "TokenId" : "Amount/TokenId"}
                    </div>
                    <input
                      className="input input-bordered input-sm w-full"
                      value={
                        asset.standard === "erc721" ? (asset.tokenId ?? "") : (asset.amount ?? asset.tokenId ?? "")
                      }
                      onChange={e => {
                        const value = e.target.value;
                        if (asset.standard === "erc721") updateRow(idx, { tokenId: value });
                        else if (asset.standard === "erc20") updateRow(idx, { amount: value });
                        else updateRow(idx, { tokenId: value, amount: value });
                      }}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button className="btn btn-ghost btn-xs" onClick={() => removeRow(idx)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary rounded-full" disabled={!canNext} onClick={props.onNext}>
          Ready?
        </button>
      </div>
    </div>
  );
}
