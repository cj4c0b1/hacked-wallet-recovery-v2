"use client";

import { useMemo, useState } from "react";
import type { RecoveryAsset, SignedAuthorizationObject } from "./types";
import { Address, EtherInput } from "@scaffold-ui/components";
import type { Address as AddressType } from "viem";
import { parseEther } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { safeJsonStringify } from "~~/utils/recovery/jsonSafe";

export function Execute(props: {
  safeAddress: AddressType;
  assets: RecoveryAsset[];
  authorization: SignedAuthorizationObject;
  simulation: any;
  onBack: () => void;
}) {
  const paymasterAddress = process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS;
  if (!paymasterAddress) throw new Error("NEXT_PUBLIC_PAYMASTER_ADDRESS is not set");
  const { address: connectedAddress, chain } = useAccount();

  const [feeEth, setFeeEth] = useState("0.001");
  const feeWei = useMemo(() => {
    try {
      return parseEther((feeEth || "0") as `${number}`);
    } catch {
      return 0n;
    }
  }, [feeEth]);

  const sendTx = useSendTransaction();
  const receipt = useWaitForTransactionReceipt({ hash: sendTx.data });

  const [execBusy, setExecBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<any>(null);

  const execute = async () => {
    if (!sendTx.data) return;
    setExecBusy(true);
    setExecError(null);
    try {
      const body = {
        safeAddress: props.safeAddress,
        assets: props.assets,
        authorization: props.authorization,
        paymentTxHash: sendTx.data,
      };
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: safeJsonStringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setExecResult(json);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : "Execute failed.");
    } finally {
      setExecBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300">
        <h2 className="text-xl font-bold mb-2">4) Pay fee + Execute (server)</h2>
        <p className="text-sm text-neutral">
          You pay a fee from the connected safe wallet, then the server verifies it and broadcasts the sponsored
          EIP-7702 transaction(s).
        </p>
      </div>

      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300 space-y-3">
        <div className="text-sm font-semibold">Connected wallet</div>
        <div className="text-sm">
          <Address address={connectedAddress} />
          <span className="ml-2 text-xs text-neutral">({chain?.name ?? "Unknown network"})</span>
        </div>

        <div className="text-sm font-semibold">Service fee (ETH)</div>
        <EtherInput
          placeholder="0.001"
          onValueChange={({ valueInEth }) => setFeeEth(valueInEth)}
          defaultValue={feeEth}
          style={{ width: "100%" }}
        />

        <button
          className="btn btn-primary btn-sm rounded-full"
          disabled={sendTx.isPending}
          onClick={() => {
            sendTx.sendTransaction({ to: paymasterAddress, value: feeWei });
          }}
        >
          {sendTx.isPending ? <span className="loading loading-spinner loading-sm" /> : null}
          Send fee
        </button>

        {sendTx.error ? <div className="text-sm text-error break-words">{sendTx.error.message}</div> : null}
        {sendTx.data ? (
          <div className="text-xs text-neutral break-words">
            Payment tx hash: <span className="font-mono">{sendTx.data}</span>
          </div>
        ) : null}
        {receipt.data ? (
          <div className="text-xs text-neutral">Payment confirmed in block {receipt.data.blockNumber.toString()}.</div>
        ) : null}
      </div>

      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300 space-y-3">
        <div className="text-sm font-semibold">Execute</div>
        <button className="btn btn-primary btn-sm rounded-full" onClick={execute} disabled={execBusy}>
          {execBusy ? <span className="loading loading-spinner loading-sm" /> : null}
          Call /api/execute
        </button>
        {execError ? <div className="text-sm text-error break-words">{execError}</div> : null}
        <pre className="bg-base-200 rounded-2xl p-4 text-xs overflow-auto">
          {execResult ? safeJsonStringify(execResult, 2) : "—"}
        </pre>
      </div>

      <div className="flex justify-between">
        <button className="btn btn-ghost rounded-full" onClick={props.onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
