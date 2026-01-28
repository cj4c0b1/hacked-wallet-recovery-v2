"use client";

import { useMemo, useState } from "react";
import type { SignedAuthorizationObject } from "./types";
import type { Address } from "viem";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { usePublicClient } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";
import { tryGetDelegateForChain } from "~~/utils/recovery/calls";
import { normalizeHexPrivateKey, sign7702Authorization } from "~~/utils/recovery/viem7702";
import { getTargetNetworks } from "~~/utils/scaffold-eth/networks";

export function Authorize7702(props: {
  compromisedAddress: Address;
  authorization?: SignedAuthorizationObject;
  onChangeAuthorization: (auth?: SignedAuthorizationObject) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // Keep this flow independent from connected wallet network.
  const delegateChainId = getTargetNetworks()[0]?.id ?? scaffoldConfig.targetNetworks[0].id;
  const publicClient = usePublicClient({ chainId: delegateChainId });

  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delegateAddress = useMemo(() => {
    return tryGetDelegateForChain(delegateChainId)?.address;
  }, [delegateChainId]);

  const derived = useMemo(() => {
    const pk = normalizeHexPrivateKey(privateKeyInput);
    if (!pk) return null;
    try {
      return privateKeyToAccount(pk).address;
    } catch {
      return null;
    }
  }, [privateKeyInput]);

  const canSign = Boolean(publicClient && delegateAddress && normalizeHexPrivateKey(privateKeyInput));

  const sign = async () => {
    if (!publicClient) return;
    if (!delegateAddress) {
      setError("UniversalRecoveryDelegate address not configured for the selected network.");
      return;
    }

    const pk = normalizeHexPrivateKey(privateKeyInput);
    if (!pk) {
      setError("Private key must be 32-byte hex (64 chars), with or without 0x prefix.");
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const derivedAddress = privateKeyToAccount(pk).address;
      if (getAddress(derivedAddress) !== getAddress(props.compromisedAddress)) {
        throw new Error("Private key does not match the compromised address.");
      }

      const chainId = delegateChainId;
      const nonce = Number(
        await publicClient.getTransactionCount({ address: props.compromisedAddress, blockTag: "pending" }),
      );

      const signed = (await sign7702Authorization({
        privateKey: pk,
        chainId,
        nonce,
        contractAddress: delegateAddress,
      })) as any;

      // viem returns Signature parts as hex + v as bigint.
      const vBig = typeof signed.v === "string" ? BigInt(signed.v) : BigInt(signed.v);
      const yParityBig =
        typeof signed.yParity !== "undefined"
          ? typeof signed.yParity === "string"
            ? BigInt(signed.yParity)
            : BigInt(signed.yParity)
          : vBig === 27n || vBig === 28n
            ? vBig - 27n
            : vBig;
      if (yParityBig !== 0n && yParityBig !== 1n) {
        throw new Error(`Invalid signature parity. Expected yParity 0/1, got ${yParityBig.toString()}`);
      }
      const auth: SignedAuthorizationObject = {
        address: signed.address,
        chainId: signed.chainId,
        nonce: signed.nonce,
        r: signed.r,
        s: signed.s,
        yParity: Number(yParityBig) as 0 | 1,
        // keep v for backwards compat / debugging
        v: vBig,
      };

      props.onChangeAuthorization(auth);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sign authorization.");
    } finally {
      setBusy(false);
    }
  };

  const canNext = Boolean(props.authorization);

  const safeJson = (value: unknown) =>
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);

  return (
    <div className="space-y-4">
      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300">
        <h2 className="text-xl font-bold mb-2">2) Sign EIP-7702 Authorization</h2>
        <p className="text-sm text-neutral">
          Your private key stays in this browser memory only. It is never sent to the server.
        </p>

        <div className="mt-4 space-y-2">
          <div className="text-sm font-semibold">Private key (hex)</div>
          <input
            className="input input-bordered w-full font-mono"
            placeholder="0x…"
            value={privateKeyInput}
            onChange={e => {
              setPrivateKeyInput(e.target.value);
              props.onChangeAuthorization(undefined);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="text-xs text-neutral">
            Derived address: <span className="font-mono">{derived ?? "—"}</span>
          </div>
          <div className="text-xs text-neutral">
            Delegate contract: <span className="font-mono">{delegateAddress ?? "—"}</span>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary btn-sm rounded-full" onClick={sign} disabled={!canSign || busy}>
            {busy ? <span className="loading loading-spinner loading-sm" /> : null}
            Sign authorization
          </button>
          <button
            className="btn btn-ghost btn-sm rounded-full"
            onClick={() => {
              setPrivateKeyInput("");
              props.onChangeAuthorization(undefined);
            }}
          >
            Clear
          </button>
        </div>

        {error ? <div className="mt-3 text-sm text-error break-words">{error}</div> : null}
      </div>

      <div className="bg-base-100 rounded-3xl p-5 sm:p-6 border border-base-300">
        <h3 className="text-lg font-bold mb-2">Signed Authorization</h3>
        <pre className="bg-base-200 rounded-2xl p-4 text-xs overflow-auto">
          {props.authorization ? safeJson(props.authorization) : "—"}
        </pre>
      </div>

      <div className="flex justify-between">
        <button className="btn btn-ghost rounded-full" onClick={props.onBack}>
          Back
        </button>
        <button className="btn btn-primary rounded-full" disabled={!canNext} onClick={props.onNext}>
          Ready?
        </button>
      </div>
    </div>
  );
}
