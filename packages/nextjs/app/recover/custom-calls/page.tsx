import Link from "next/link";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "Custom calls",
  description: "How to add custom contract calls during recovery",
  canonicalPath: "/recover/custom-calls",
});

const CustomCallsPage: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="w-full max-w-3xl px-5">
        <div className="bg-base-100 rounded-3xl p-5 sm:p-8 border border-base-300">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-3xl font-bold m-0">Custom calls</h1>
            <Link href="/" className="link text-sm">
              Back to recovery
            </Link>
          </div>

          <p className="mt-4 text-sm text-neutral leading-relaxed">
            Some assets can’t be recovered with a simple token transfer. For example: Aave/Spark deposits, Morpho
            positions, Curve pool deposits, or vault shares. In those cases you need to perform a protocol action first
            (withdraw/redeem/unwrap). This page shows the easiest way to copy the exact onchain call from a protocol UI
            and paste it into the recovery flow.
          </p>

          <div className="mt-6 rounded-2xl bg-base-200 p-5">
            <div className="font-semibold">Important</div>
            <div className="mt-2 text-sm text-neutral leading-relaxed">
              You should <span className="font-semibold">not</span> approve/sign anything from the compromised wallet
              while doing this. The goal is to use the protocol app only long enough to open the “Confirm transaction”
              screen in your wallet, then copy the details.
            </div>
          </div>

          <h2 className="mt-8 text-xl font-bold">Recommended: Raw tx (copy contract + calldata)</h2>
          <p className="mt-3 text-sm text-neutral leading-relaxed">
            This is the most reliable method because you’re copying the exact calldata the protocol UI would send.
          </p>

          <ol className="mt-3 text-sm text-neutral space-y-3 list-decimal list-inside">
            <li>
              In the recovery app, go to <span className="font-semibold">Select assets</span> →{" "}
              <span className="font-semibold">Custom</span>.
            </li>
            <li>
              Open the protocol’s app (use the “Manage positions” link) and navigate to the action you need (usually{" "}
              <span className="font-semibold">Withdraw</span> or <span className="font-semibold">Redeem</span>).
            </li>
            <li>
              Continue until your wallet opens the <span className="font-semibold">Confirm transaction</span> screen for
              the compromised wallet.
            </li>
            <li>
              In the wallet’s transaction details, copy:
              <ul className="mt-2 ml-4 space-y-1 list-disc list-inside">
                <li>
                  <span className="font-semibold">To / Interacting with</span> (the contract address)
                </li>
                <li>
                  <span className="font-semibold">Data / Calldata</span> (0x… hex)
                </li>
              </ul>
              Your wallet might label this as “Hex data”, “Input data”, or “Calldata”.
            </li>
            <li>
              Back in the recovery app, in <span className="font-semibold">Custom</span> choose{" "}
              <span className="font-semibold">Raw tx</span>, paste the calldata, and ensure the Contract field matches
              the <span className="font-semibold">To</span> address you copied.
            </li>
            <li>
              Click <span className="font-semibold">Add call</span>. This call will be executed as part of the recovery
              batch, without you needing to sign from the compromised wallet.
            </li>
          </ol>

          <h2 className="mt-8 text-xl font-bold">Alternative: Function signature (when calldata isn’t available)</h2>
          <p className="mt-3 text-sm text-neutral leading-relaxed">
            If your wallet UI doesn’t show calldata, you can build the call from the contract’s ABI.
          </p>

          <ol className="mt-3 text-sm text-neutral space-y-3 list-decimal list-inside">
            <li>
              Find the contract on the chain’s block explorer (BaseScan, Etherscan, etc.) and open the{" "}
              <span className="font-semibold">Contract</span> tab.
            </li>
            <li>
              If it’s verified, you’ll see read/write methods or an ABI. Identify the method you need (often{" "}
              <span className="font-mono">withdraw(...)</span>, <span className="font-mono">redeem(...)</span>,{" "}
              <span className="font-mono">exit(...)</span>, etc.).
            </li>
            <li>
              The <span className="font-semibold">function signature</span> is the method name plus parameter types, for
              example: <span className="font-mono">withdraw(uint256,address)</span>.
            </li>
            <li>
              In the recovery app’s <span className="font-semibold">Custom</span> tab, enter the Contract address and
              paste the function signature. Then fill in the inputs.
            </li>
            <li>
              For address parameters you can use:
              <ul className="mt-2 ml-4 space-y-1 list-disc list-inside">
                <li>
                  <span className="font-mono">$SAFE</span> → your destination safe address
                </li>
                <li>
                  <span className="font-mono">$COMPROMISED</span> → the compromised wallet address
                </li>
              </ul>
            </li>
          </ol>

          <div className="mt-8 text-xs text-neutral">
            Tip: if you can see a past successful withdraw/redeem tx for a similar position (on a block explorer), you
            can copy the calldata from that transaction as well and use the Raw tx method.
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomCallsPage;
