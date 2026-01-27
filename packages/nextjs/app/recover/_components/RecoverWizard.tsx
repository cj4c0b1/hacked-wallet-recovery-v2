"use client";

import { useEffect, useMemo, useState } from "react";
import { DoneStep } from "./steps/DoneStep";
import { EnterPrivateKeyStep } from "./steps/EnterPrivateKeyStep";
import { IntroStep } from "./steps/IntroStep";
import { PayAndExecuteStep } from "./steps/PayAndExecuteStep";
import { SelectAssetsStep } from "./steps/SelectAssetsStep";
import type { RecoveryAsset } from "./types";
import type { Address, Hex } from "viem";
import { useRecoveryWizardStore } from "~~/services/store/recoveryWizard";
import { safeJsonStringify } from "~~/utils/recovery/jsonSafe";
import type { ZerionNftView, ZerionPositionsView } from "~~/utils/recovery/zerion";

type Step = "intro" | "pk" | "assets" | "pay" | "done";

export function RecoverWizard() {
  const [step, setStep] = useState<Step>("intro");
  const setGlobalStep = useRecoveryWizardStore(s => s.setStep);
  const resetGlobal = useRecoveryWizardStore(s => s.reset);

  useEffect(() => {
    setGlobalStep(step);
  }, [setGlobalStep, step]);

  useEffect(() => {
    return () => resetGlobal();
  }, [resetGlobal]);

  const [compromisedAddress, setCompromisedAddress] = useState<Address | undefined>(undefined);
  const [compromisedPrivateKey, setCompromisedPrivateKey] = useState<Hex | undefined>(undefined);
  const [assets, setAssets] = useState<RecoveryAsset[]>([]);
  const [positionsView, setPositionsView] = useState<ZerionPositionsView | null>(null);
  const [nfts, setNfts] = useState<ZerionNftView[]>([]);
  const [selectedAssetIndexes, setSelectedAssetIndexes] = useState<number[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [executeResult, setExecuteResult] = useState<{ result: any; executedAssets: RecoveryAsset[] } | null>(null);

  const selectedAssets = useMemo(
    () => assets.filter((_, i) => selectedAssetIndexes.includes(i)),
    [assets, selectedAssetIndexes],
  );

  return (
    <div className="flex items-center flex-col grow">
      <div className={`w-full max-w-5xl px-5 space-y-6 ${step === "intro" ? "pt-10" : "pt-6"}`}>
        {step === "intro" ? <IntroStep onNext={() => setStep("pk")} /> : null}

        {step === "pk" ? (
          <EnterPrivateKeyStep
            onBack={() => setStep("intro")}
            onNext={async next => {
              setCompromisedPrivateKey(next.privateKey);
              setCompromisedAddress(next.compromisedAddress);
              setAssets([]);
              setPositionsView(null);
              setNfts([]);
              setSelectedAssetIndexes([]);
              setQuote(null);
              setExecuteResult(null);

              const scanRes = await fetch("/api/scan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: safeJsonStringify({ compromisedAddress: next.compromisedAddress }),
              });
              if (!scanRes.ok) throw new Error(await scanRes.text());
              const scanJson = await scanRes.json();
              const nextAssets = Array.isArray(scanJson?.assets) ? (scanJson.assets as RecoveryAsset[]) : [];
              const nextPositionsView = (scanJson?.positionsView ?? null) as ZerionPositionsView | null;
              const nextNfts = Array.isArray(scanJson?.nfts) ? (scanJson.nfts as ZerionNftView[]) : [];

              setAssets(nextAssets);
              setPositionsView(nextPositionsView);
              setNfts(nextNfts);
              // Don't auto-select assets by default; user must explicitly choose what to recover.
              setSelectedAssetIndexes([]);
              setStep("assets");
            }}
          />
        ) : null}

        {step === "assets" ? (
          <SelectAssetsStep
            compromisedAddress={compromisedAddress}
            assets={assets}
            onChangeAssets={setAssets}
            positionsView={positionsView}
            nfts={nfts}
            selectedIndexes={selectedAssetIndexes}
            onChangeSelected={setSelectedAssetIndexes}
            onBack={() => setStep("pk")}
            onNext={() => setStep("pay")}
          />
        ) : null}

        {step === "pay" && compromisedAddress && compromisedPrivateKey ? (
          <PayAndExecuteStep
            compromisedAddress={compromisedAddress}
            compromisedPrivateKey={compromisedPrivateKey}
            assets={selectedAssets}
            positionsView={positionsView}
            nfts={nfts}
            quote={quote}
            onQuote={setQuote}
            onExecute={res => {
              setExecuteResult(res);
              setStep("done");
            }}
            onBack={() => setStep("assets")}
          />
        ) : null}

        {step === "done" ? (
          <DoneStep
            result={executeResult?.result}
            executedAssets={executeResult?.executedAssets ?? []}
            onRestart={() => {
              setCompromisedPrivateKey(undefined);
              setCompromisedAddress(undefined);
              setAssets([]);
              setPositionsView(null);
              setNfts([]);
              setSelectedAssetIndexes([]);
              setQuote(null);
              setExecuteResult(null);
              setStep("intro");
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
