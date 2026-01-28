"use client";

import { useState } from "react";
import type { RecoveryAsset } from "../types";
import { Address } from "@scaffold-ui/components";
import type { Address as AddressType } from "viem";
import { UnderlinedTooltip } from "~~/components/UnderlinedTooltip";
import { safeJsonStringify } from "~~/utils/recovery/jsonSafe";
import type { ZerionNftView, ZerionPositionsView } from "~~/utils/recovery/zerion";

export function KeyAndScanStep(props: {
  compromisedAddress: AddressType;
  onBack: () => void;
  onNext: (result: {
    compromisedAddress: AddressType;
    assets: RecoveryAsset[];
    positionsView: ZerionPositionsView | null;
    nfts: ZerionNftView[];
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsPreview, setAssetsPreview] = useState<RecoveryAsset[] | null>(null);

  const run = async () => {
    const compromisedAddress = props.compromisedAddress;
    setBusy(true);
    setError(null);
    try {
      const scanRes = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: safeJsonStringify({
          compromisedAddress,
          // No chain filter: show everything Zerion can find.
        }),
      });
      if (!scanRes.ok) throw new Error(await scanRes.text());
      const scanJson = await scanRes.json();
      const assets = Array.isArray(scanJson?.assets) ? (scanJson.assets as RecoveryAsset[]) : [];
      const positionsView = (scanJson?.positionsView ?? null) as ZerionPositionsView | null;
      const nfts = Array.isArray(scanJson?.nfts) ? (scanJson.nfts as ZerionNftView[]) : [];
      setAssetsPreview(assets);

      props.onNext({ compromisedAddress, assets, positionsView, nfts });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to scan assets.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-base-100 rounded-3xl p-5 sm:p-8 border border-base-300">
      <h2 className="text-2xl font-bold m-0">Scan wallet</h2>
      <p className="mt-2 text-sm text-neutral">
        We’ll scan your compromised wallet for assets first. Authorizations will be signed automatically right before
        quoting and executing.
      </p>

      <div className="mt-6 space-y-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          Compromised address
          <UnderlinedTooltip
            text="Why do you need this?"
            tip="We use this address to scan for assets and prepare the recovery transaction. Your private key never leaves this browser session."
            className="text-xs"
          />
        </div>
        <div className="text-xs text-neutral">
          Compromised address: <Address address={props.compromisedAddress} />
        </div>
      </div>

      {error ? <div className="mt-3 text-sm text-error break-words">{error}</div> : null}

      <div className="mt-8 flex justify-between">
        <button className="btn btn-ghost rounded-full" onClick={props.onBack} disabled={busy}>
          Back
        </button>
        <button className="btn btn-primary rounded-full" onClick={run} disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Continue
        </button>
      </div>

      {assetsPreview ? <div className="mt-6 text-xs text-neutral">Found {assetsPreview.length} assets.</div> : null}
    </div>
  );
}
