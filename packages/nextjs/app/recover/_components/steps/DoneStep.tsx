"use client";

import { useMemo } from "react";
import type { RecoveryAsset } from "../types";
import { Address } from "@scaffold-ui/components";
import type { Address as AddressType } from "viem";
import { safeJsonStringify } from "~~/utils/recovery/jsonSafe";
import { getBlockExplorerTxLink, getTargetNetworkById } from "~~/utils/scaffold-eth/networks";

export function DoneStep(props: { result: any; executedAssets: RecoveryAsset[]; onRestart: () => void }) {
  const ok = Boolean(props.result?.ok);
  const safeAddress = props.result?.safeAddress as AddressType | undefined;
  const payment = props.result?.payment as any | undefined;
  const perChainResults = (props.result?.results ?? null) as Record<string, any> | null;
  const paymentChainId = Number(payment?.chainId);
  const paymentTxHash = (payment?.paymentTxHash as string | undefined) ?? undefined;
  const paymentTxUrl =
    Number.isFinite(paymentChainId) && paymentTxHash ? getBlockExplorerTxLink(paymentChainId, paymentTxHash) : "";
  const paymentChainName = Number.isFinite(paymentChainId)
    ? (getTargetNetworkById(paymentChainId)?.name ?? `chainId=${paymentChainId}`)
    : undefined;
  const chainIds = useMemo(() => {
    if (!perChainResults) return [];
    return Object.keys(perChainResults)
      .map(x => Number(x))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
  }, [perChainResults]);
  const chainNames = useMemo(() => {
    return chainIds.map(chainId => getTargetNetworkById(chainId)?.name ?? `chainId=${chainId}`);
  }, [chainIds]);

  return (
    <div className="bg-base-100 rounded-3xl p-5 sm:p-8 border border-base-300">
      <h2 className="text-2xl font-bold m-0">{ok ? "Assets moved" : "Recovery attempt completed"}</h2>
      <p className="mt-2 text-sm text-neutral">
        {ok
          ? "We broadcasted the recovery transaction and verified the selected assets onchain."
          : "The transaction did not succeed. If you see a decoded error below, try selecting fewer assets or retry later."}
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-base-300 p-4">
          <div className="text-xs text-neutral font-semibold">Safe wallet</div>
          <div className="text-sm mt-1">
            <Address address={safeAddress} />
          </div>
        </div>
        <div className="rounded-2xl border border-base-300 p-4">
          <div className="text-xs text-neutral font-semibold">Payment</div>
          <div className="text-sm mt-1 break-words font-mono">
            {paymentTxHash ? (
              paymentTxUrl ? (
                <a href={paymentTxUrl} target="_blank" rel="noreferrer" className="link">
                  {paymentTxHash}
                </a>
              ) : (
                paymentTxHash
              )
            ) : (
              "—"
            )}
          </div>
          <div className="text-xs mt-1 text-neutral">{paymentChainName ? `on ${paymentChainName}` : "—"}</div>
        </div>
        <div className="rounded-2xl border border-base-300 p-4">
          <div className="text-xs text-neutral font-semibold">Chains executed</div>
          <div className="text-sm mt-1">{chainNames.length ? chainNames.join(", ") : "—"}</div>
        </div>
      </div>

      {perChainResults ? (
        <div className="mt-6 rounded-2xl border border-base-300 p-4">
          <div className="font-semibold">Per-chain results</div>
          <div className="mt-3 space-y-3">
            {chainIds.map(chainId => {
              const r = (perChainResults as any)[String(chainId)] ?? (perChainResults as any)[chainId];
              const chainOk = Boolean(r?.ok);
              const txHash = r?.txHash as string | undefined;
              const checks = r?.checks as any[] | null | undefined;
              const revertSummary = (r?.revert?.summary as string | undefined) ?? undefined;
              const executedAssets = props.executedAssets.filter(a => a.chainId === chainId);
              const chain = getTargetNetworkById(chainId);
              const chainName = chain?.name ?? `chainId=${chainId}`;
              const txUrl = txHash ? getBlockExplorerTxLink(chainId, txHash) : "";
              return (
                <details key={chainId} className="rounded-2xl border border-base-300 p-4" open>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          {chainName}{" "}
                          <span className={`ml-2 text-xs font-semibold ${chainOk ? "text-green-600" : "text-error"}`}>
                            {chainOk ? "SUCCESS" : "FAILED"}
                          </span>
                        </div>
                        <div className="text-xs text-neutral mt-1">
                          tx:{" "}
                          <span className="font-mono break-words">
                            {txHash ? (
                              txUrl ? (
                                <a href={txUrl} target="_blank" rel="noreferrer" className="link">
                                  {txHash}
                                </a>
                              ) : (
                                txHash
                              )
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                        {revertSummary ? (
                          <div className="text-[11px] text-neutral mt-1">
                            revert: <span className="font-mono">{revertSummary}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="text-xs text-neutral shrink-0">
                        {Array.isArray(checks)
                          ? `${checks.filter((c: any) => c.ok).length}/${checks.length} verified`
                          : "—"}
                      </div>
                    </div>
                  </summary>

                  <div className="mt-3 rounded-2xl border border-base-300 p-3">
                    <div className="text-xs text-neutral mb-2">Executed calls</div>
                    <div className="space-y-2">
                      {executedAssets.length ? (
                        executedAssets.map((a, localIndex) => {
                          const check = Array.isArray(checks)
                            ? checks.find((c: any) => Number(c?.index) === localIndex)
                            : null;
                          const callOk = chainOk ? (check ? Boolean(check.ok) : true) : false;

                          const subtitle =
                            a.standard === "customcall"
                              ? a.functionSignature
                                ? `fn=${a.functionSignature}`
                                : a.dataHex
                                  ? `data=${String(a.dataHex).slice(0, 18)}…`
                                  : "custom call"
                              : null;

                          return (
                            <div
                              key={`${chainId}:${a.standard}:${a.contract}:${a.tokenId ?? ""}:${localIndex}`}
                              className="text-xs"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-semibold">{a.standard.toUpperCase()}</span>
                                    {subtitle ? <span className="font-mono opacity-70">{subtitle}</span> : null}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral">
                                    <span className="opacity-70">contract:</span>{" "}
                                    <Address address={a.contract} chain={chain} />
                                    {typeof a.tokenId !== "undefined" ? (
                                      <span className="font-mono opacity-70">tokenId={a.tokenId}</span>
                                    ) : null}
                                    {typeof a.amount !== "undefined" ? (
                                      <span className="font-mono opacity-70">amount={a.amount}</span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className={`text-xs font-semibold ${callOk ? "text-green-600" : "text-error"}`}>
                                  {callOk ? "SUCCESS" : "FAILED"}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-xs text-neutral">—</div>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}

      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-neutral">Show raw response</summary>
        <pre className="mt-3 bg-base-200 rounded-2xl p-4 text-xs overflow-auto">
          {safeJsonStringify(props.result, 2)}
        </pre>
      </details>

      <div className="mt-8 flex justify-end">
        <button className="btn btn-primary rounded-full" onClick={props.onRestart}>
          Start over
        </button>
      </div>
    </div>
  );
}
