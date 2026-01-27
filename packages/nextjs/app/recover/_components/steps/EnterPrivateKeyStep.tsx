"use client";

import { useMemo, useState } from "react";
import { Address as AddressComponent } from "@scaffold-ui/components";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeHexPrivateKey } from "~~/utils/recovery/viem7702";

export function EnterPrivateKeyStep(props: {
  onBack: () => void;
  onNext: (result: { privateKey: Hex; compromisedAddress: Address }) => Promise<void>;
}) {
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pk = useMemo(() => normalizeHexPrivateKey(privateKeyInput), [privateKeyInput]);
  const derivedAddress = useMemo(() => {
    if (!pk) return null;
    try {
      return privateKeyToAccount(pk).address as Address;
    } catch {
      return null;
    }
  }, [pk]);

  const canContinue = Boolean(pk && derivedAddress);

  return (
    <div className="bg-base-100 rounded-3xl p-8 border border-base-300 space-y-6">
      <div>
        <h2 className="text-2xl font-bold m-0">Paste your compromised wallet&apos;s private key</h2>
        <p className="mt-2 text-sm text-neutral">
          This private key stays in-memory in your browser session and is used to sign the recovery transactions. It is
          never sent to our server.
          <br /> You can read more about{" "}
          <a href="/how-it-works" className="link">
            how it works
          </a>{" "}
          and also feel free to{" "}
          <a href="https://github.com/buidlguidl/hacked-wallet-recovery-v2" className="link">
            audit the code
          </a>{" "}
          that this website uses.
        </p>
      </div>

      <div className="rounded-2xl border border-base-300 p-4 space-y-2">
        <div className="text-sm font-semibold">Private key (hex)</div>
        <input
          className="input input-bordered w-full font-mono [-webkit-text-security:disc]"
          type="text"
          placeholder="0x…"
          name="privateKey"
          value={privateKeyInput}
          onChange={e => {
            setPrivateKeyInput(e.target.value);
            setTouched(true);
            setError(null);
          }}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          spellCheck={false}
        />
        {touched && privateKeyInput.trim() && !pk ? (
          <div className="text-xs text-warning">Private key must be 32-byte hex (64 chars), with or without 0x.</div>
        ) : null}
        {derivedAddress ? (
          <div className="text-xs text-neutral break-words flex items-center gap-2">
            <span>Derived address:</span>
            <AddressComponent address={derivedAddress} />
          </div>
        ) : null}
      </div>

      {error ? <div className="text-sm text-error break-words">{error}</div> : null}

      <div className="flex justify-between">
        <button className="btn btn-ghost rounded-full" onClick={props.onBack} disabled={busy}>
          Back
        </button>
        <button
          className="btn btn-primary rounded-full"
          disabled={!canContinue || busy}
          onClick={async () => {
            if (!pk || !derivedAddress) return;
            setBusy(true);
            setError(null);
            try {
              await props.onNext({ privateKey: pk, compromisedAddress: derivedAddress });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Continue
        </button>
      </div>
    </div>
  );
}
