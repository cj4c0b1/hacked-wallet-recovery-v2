"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthorizationsByChainId } from "../authorizations";
import type { SignedAuthorizationObject } from "../types";
import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPublicClient } from "wagmi/actions";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import { tryGetDelegateForChain } from "~~/utils/recovery/calls";
import { normalizeHexPrivateKey, sign7702Authorization } from "~~/utils/recovery/viem7702";

export function SignAuthorizationsStep(props: {
  compromisedAddress: Address;
  chainIds: number[];
  onBack: () => void;
  onNext: (result: { authorizationsByChainId: AuthorizationsByChainId }) => void;
}) {
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizationsByChainId, setAuthorizationsByChainId] = useState<AuthorizationsByChainId | null>(null);
  const signAttemptIdRef = useRef(0);
  const lastSignedKeyRef = useRef<string | null>(null);

  const chainIds = useMemo(
    () =>
      Array.from(new Set(props.chainIds))
        .filter(x => Number.isFinite(x))
        .sort((a, b) => a - b),
    [props.chainIds],
  );

  const pk = useMemo(() => normalizeHexPrivateKey(privateKeyInput), [privateKeyInput]);
  const derivedAddress = useMemo(() => {
    if (!pk) return null;
    try {
      return privateKeyToAccount(pk).address;
    } catch {
      return null;
    }
  }, [pk]);

  const delegateAddressesByChainId = useMemo(() => {
    const map: Record<number, Address | undefined> = {};
    for (const chainId of chainIds) {
      map[chainId] = tryGetDelegateForChain(chainId)?.address;
    }
    return map;
  }, [chainIds]);

  const canAutoSign = Boolean(chainIds.length && pk && derivedAddress);

  useEffect(() => {
    // Reset when inputs are incomplete.
    if (!pk || !derivedAddress || !chainIds.length) {
      lastSignedKeyRef.current = null;
      setBusy(false);
      return;
    }

    const key = [
      pk,
      getAddress(props.compromisedAddress),
      chainIds.join(","),
      chainIds.map(id => delegateAddressesByChainId[id] ?? "—").join(","),
    ].join("|");

    // Avoid re-signing on re-render if nothing relevant changed.
    if (lastSignedKeyRef.current === key && authorizationsByChainId) return;

    const attemptId = ++signAttemptIdRef.current;
    const run = async () => {
      try {
        setBusy(true);
        setError(null);
        setAuthorizationsByChainId(null);

        if (getAddress(derivedAddress) !== getAddress(props.compromisedAddress)) {
          throw new Error("Private key does not match the compromised address.");
        }

        const results = await Promise.all(
          chainIds.map(async chainId => {
            const delegateAddress = delegateAddressesByChainId[chainId];
            if (!delegateAddress)
              throw new Error(`UniversalRecoveryDelegate address not configured for chainId=${chainId}.`);

            const publicClient = getPublicClient(wagmiConfig as any, { chainId });
            if (!publicClient) throw new Error(`No public client available for chainId=${chainId}.`);

            const nonce = Number(
              await publicClient.getTransactionCount({ address: props.compromisedAddress, blockTag: "pending" }),
            );

            const signed = (await sign7702Authorization({
              privateKey: pk as Hex,
              chainId,
              nonce,
              contractAddress: delegateAddress,
            })) as any;

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
              throw new Error(
                `Invalid signature parity for chainId=${chainId}. Expected yParity 0/1, got ${yParityBig.toString()}`,
              );
            }
            const delegateAuthorization: SignedAuthorizationObject = {
              address: signed.address,
              chainId: signed.chainId,
              nonce: signed.nonce,
              r: signed.r,
              s: signed.s,
              yParity: Number(yParityBig) as 0 | 1,
              v: vBig,
            };

            return [chainId, delegateAuthorization] as const;
          }),
        );

        // Ignore stale attempts.
        if (signAttemptIdRef.current !== attemptId) return;

        lastSignedKeyRef.current = key;
        setAuthorizationsByChainId(Object.fromEntries(results));
      } catch (e) {
        if (signAttemptIdRef.current !== attemptId) return;
        lastSignedKeyRef.current = null;
        setError(e instanceof Error ? e.message : "Failed to sign authorizations.");
      } finally {
        if (signAttemptIdRef.current !== attemptId) return;
        setBusy(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk, derivedAddress, chainIds, props.compromisedAddress, delegateAddressesByChainId]);

  const canContinue = Boolean(authorizationsByChainId);

  return (
    <div className="bg-base-100 rounded-3xl p-5 sm:p-8 border border-base-300 space-y-6">
      <div>
        <h2 className="text-2xl font-bold m-0">Enter private key</h2>
        <p className="mt-2 text-sm text-neutral">
          Now that you&apos;ve picked assets, paste the private key for the compromised wallet. We&apos;ll sign the
          required EIP-7702 <span className="font-semibold">delegation</span> authorizations for each chain.
        </p>
        <p className="mt-2 text-xs text-neutral">
          Note: these authorizations <span className="font-semibold">do not include</span> your recovery destination
          address or the final transaction calldata. You will confirm the recovery destination in the next step, and the
          server will build + broadcast the recovery transactions using these authorizations.
        </p>
      </div>

      <div className="rounded-2xl border border-base-300 p-4 space-y-2">
        <div className="text-sm font-semibold">Private key (hex)</div>
        <input
          className="input input-bordered w-full font-mono"
          placeholder="0x…"
          value={privateKeyInput}
          onChange={e => {
            setPrivateKeyInput(e.target.value);
            setAuthorizationsByChainId(null);
            setError(null);
            lastSignedKeyRef.current = null;
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="text-xs text-neutral break-words">
          Derived address: <span className="font-mono">{derivedAddress ?? "—"}</span>
        </div>
        <div className="text-xs text-neutral break-words">
          Expected: <span className="font-mono">{props.compromisedAddress}</span>
        </div>
        {privateKeyInput.trim() && !pk ? (
          <div className="text-xs text-warning">
            Private key must be 32-byte hex (64 chars), with or without 0x prefix.
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-base-300 p-4 space-y-1 text-sm">
        <div>
          ChainIds: <span className="font-mono">{chainIds.join(", ") || "—"}</span>
        </div>
        {chainIds.map(chainId => (
          <div key={chainId} className="text-xs text-neutral break-words">
            Delegate ({chainId}): <span className="font-mono">{delegateAddressesByChainId[chainId] ?? "—"}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-base-300 p-4 space-y-2">
        <div className="text-sm font-semibold">Authorization status</div>
        {!pk || !chainIds.length ? (
          <div className="text-sm text-neutral">Enter a private key to continue.</div>
        ) : !derivedAddress ? (
          <div className="text-sm text-neutral">Checking key…</div>
        ) : error ? (
          <div className="text-sm text-error break-words">{error}</div>
        ) : busy && canAutoSign ? (
          <div className="text-sm text-neutral flex items-center gap-2">
            <span className="loading loading-spinner loading-sm" />
            Signing authorizations…
          </div>
        ) : authorizationsByChainId ? (
          <div className="text-sm text-success">Delegation authorizations signed. Destination is chosen next.</div>
        ) : (
          <div className="text-sm text-neutral">Ready to sign.</div>
        )}
      </div>

      <div className="flex justify-between">
        <button className="btn btn-ghost rounded-full" onClick={props.onBack} disabled={busy}>
          Back
        </button>
        <button
          className="btn btn-primary rounded-full"
          disabled={!canContinue || busy}
          onClick={() => {
            if (!authorizationsByChainId) return;
            props.onNext({ authorizationsByChainId });
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
