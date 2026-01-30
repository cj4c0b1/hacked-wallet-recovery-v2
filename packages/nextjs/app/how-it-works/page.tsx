import Link from "next/link";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "How it works",
  description: "How the recovery flow works, and why it’s safe",
  canonicalPath: "/how-it-works",
});

const HowItWorksPage: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="w-full max-w-3xl px-5">
        <div className="bg-base-100 rounded-3xl p-5 sm:p-8 border border-base-300">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold m-0">How it works</h1>
            <Link href="/" className="link text-sm">
              Back to recovery
            </Link>
          </div>

          <p className="mt-4 text-sm text-neutral leading-relaxed">
            This page explains what the site does in plain English, and how we keep it safe. There’s also an{" "}
            <span className="font-semibold">Advanced / technical details</span> section below for anyone who wants the
            exact mechanics.
          </p>

          <div className="mt-6 rounded-2xl bg-base-200 p-5">
            <h2 className="text-lg font-bold m-0">Plain-English summary</h2>
            <p className="mt-3 text-sm text-neutral leading-relaxed">
              This site helps you <span className="font-semibold">move your assets to a new safe wallet</span> smoothly
              by batching the transfers and sending in a way that the hacker does not expect. You choose what to recover
              and where it goes.
            </p>
          </div>

          <div className="mt-6 rounded-2xl bg-base-200 p-5">
            <h2 className="text-lg font-bold m-0">Your private key never leaves your browser</h2>
            <ul className="mt-3 text-sm text-neutral space-y-2 list-disc list-inside">
              <li>
                <span className="font-semibold">We do not send your private key to our server.</span>
              </li>
              <li>We do not store it in localStorage, IndexedDB, cookies, or logs.</li>
              <li>
                It stays in memory in your current browser session and is cleared when you refresh/close the page.
              </li>
              <li>
                The only thing we send to our server about the compromised wallet is the{" "}
                <span className="font-semibold">public address</span> (to look up assets) and{" "}
                <span className="font-semibold">signed authorizations</span> (cryptographic proofs), never the key
                itself.
              </li>
              <li>
                If you’re worried about phishing, you can{" "}
                <a href="https://github.com/buidlguidl/hacked-wallet-recovery-v2" className="link">
                  audit the code
                </a>{" "}
                and run it yourself.
              </li>
            </ul>
          </div>

          <h2 className="mt-8 text-xl font-bold">What happens step-by-step</h2>
          <ol className="mt-3 text-sm text-neutral space-y-3 list-decimal list-inside">
            <li>
              <span className="font-semibold">You paste the compromised wallet’s private key.</span> We derive the
              public address and create signed recovery authorizations in your browser.
            </li>
            <li>
              <span className="font-semibold">We look up the wallet’s assets by address.</span> We ask our server to{" "}
              call Zerion for a portfolio scan so you can see and select what you want to recover.
            </li>
            <li>
              <span className="font-semibold">You choose a destination (“safe wallet”).</span> This is where recovered
              assets will be sent.
            </li>
            <li>
              <span className="font-semibold">We compute a quote.</span> It includes a service fee and estimated{" "}
              execution costs for the networks you’re recovering from.
            </li>
            <li>
              <span className="font-semibold">You pay the quoted fee from your safe wallet.</span> This is a normal
              onchain payment that you approve in your wallet.
            </li>
            <li>
              <span className="font-semibold">Our server broadcasts the recovery transactions.</span> After payment is
              confirmed, it submits the recovery transactions on the relevant networks and shows the results.
            </li>
          </ol>

          <h2 className="mt-8 text-xl font-bold">Advanced / technical details</h2>

          <div className="mt-3 rounded-2xl border border-base-300 p-5">
            <h3 className="text-base font-bold m-0">What data is sent to the server</h3>
            <ul className="mt-3 text-sm text-neutral space-y-2 list-disc list-inside">
              <li>
                <span className="font-semibold">Asset discovery</span>: we look up the wallet’s portfolio using{" "}
                <span className="font-semibold">Zerion</span> so you can review and select which assets to recover.
              </li>
              <li>
                <span className="font-semibold">Quote + recovery plan</span>: based on the assets you selected and the
                networks involved, we compute expected execution costs and the service fee.
              </li>
              <li>
                <span className="font-semibold">Execution</span>: after your payment is confirmed, our{" "}
                <span className="font-semibold">paymaster</span> broadcasts the recovery transactions. On networks that
                require it (or where it materially improves success), we route submission through{" "}
                <span className="font-semibold">private/encrypted mempool RPCs</span> to reduce interference (e.g. nonce
                racing by the hacker).
              </li>
            </ul>
          </div>

          <div className="mt-4 rounded-2xl border border-base-300 p-5">
            <h3 className="text-base font-bold m-0">What happens onchain</h3>
            <p className="mt-3 text-sm text-neutral leading-relaxed">
              The recovery uses <span className="font-semibold">EIP-7702</span> authorizations. Your compromised EOA{" "}
              signs an authorization (in your browser) that delegates execution to a recovery contract called{" "}
              <a
                href="https://github.com/buidlguidl/hacked-wallet-recovery-v2/blob/main/packages/foundry/contracts/UniversalRecoveryDelegate.sol"
                className="link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="font-mono">UniversalRecoveryDelegate</span>
              </a>
              . Our server then broadcasts an <span className="font-semibold">EIP-7702</span> transaction that executes
              a batch of transfers to the safe address.
            </p>
            <p className="mt-3 text-sm text-neutral leading-relaxed">
              The server uses a paymaster to send the signed authorizations. This is why you pay a fee first: the
              paymaster covers the execution costs on the destination chains.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HowItWorksPage;
