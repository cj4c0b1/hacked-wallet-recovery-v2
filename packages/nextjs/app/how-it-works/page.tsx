import Link from "next/link";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "How it works",
  description: "Technical details of the recovery flow",
});

const HowItWorksPage: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="w-full max-w-3xl px-5">
        <div className="bg-base-100 rounded-3xl p-8 border border-base-300">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold m-0">How it works</h1>
            <Link href="/" className="link text-sm">
              Back to recovery
            </Link>
          </div>

          <p className="mt-4 text-sm text-neutral leading-relaxed">
            This page explains the technical steps behind the recovery flow. You don’t need to understand any of this to
            use the product — it’s here for transparency.
          </p>

          <div className="mt-6 rounded-2xl bg-base-200 p-5">
            <h2 className="text-lg font-bold m-0">Your private key never leaves your browser</h2>
            <ul className="mt-3 text-sm text-neutral space-y-2 list-disc list-inside">
              <li>We do not send your private key to our server.</li>
              <li>We do not store it in localStorage, IndexedDB, cookies, or logs.</li>
              <li>
                It stays in memory in your current browser session and is cleared when you refresh/close the page.
              </li>
            </ul>
          </div>

          <h2 className="mt-8 text-xl font-bold">What happens step-by-step</h2>
          <ol className="mt-3 text-sm text-neutral space-y-3 list-decimal list-inside">
            <li>
              <span className="font-semibold">You enter the compromised wallet private key (client-side only).</span> We
              use it to compute the wallet address and to sign a short-lived recovery permission.
            </li>
            <li>
              <span className="font-semibold">We fetch your assets from Zerion.</span> This is just discovery so you can
              pick what to move.
            </li>
            <li>
              <span className="font-semibold">You connect a safe wallet.</span> This wallet receives the assets and pays
              the service fee.
            </li>
            <li>
              <span className="font-semibold">We generate an exact quote.</span> It includes our fixed service fee and a
              gas estimate for the recovery execution transaction.
            </li>
            <li>
              <span className="font-semibold">You pay the fee to the paymaster address.</span> Once it’s confirmed, we
              broadcast the recovery transaction.
            </li>
            <li>
              <span className="font-semibold">We confirm results onchain.</span> We check that balances/ownership
              changed for the selected assets.
            </li>
          </ol>

          <h2 className="mt-8 text-xl font-bold">How the recovery transaction works (technical)</h2>
          <p className="mt-3 text-sm text-neutral leading-relaxed">
            The recovery uses an Ethereum account feature that lets a normal wallet temporarily delegate execution to a
            smart contract. In plain terms: your compromised wallet can run a “batch transfer” program without first
            deploying a new wallet contract.
          </p>
          <p className="mt-3 text-sm text-neutral leading-relaxed">
            Our server only receives the signed recovery permission (not your private key). The server then submits the
            recovery transaction after your fee payment is confirmed.
          </p>

          <h2 className="mt-8 text-xl font-bold">Forked networks</h2>
          <p className="mt-3 text-sm text-neutral leading-relaxed">
            For testing and development, we run against a fork RPC (anvil). That lets us interact with real token
            contracts and balances without taking risk on mainnet. When you move to production, you’ll point the RPC at
            the target network.
          </p>
        </div>
      </div>
    </div>
  );
};

export default HowItWorksPage;
