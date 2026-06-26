import { RecoverWizard } from "./recover/_components/RecoverWizard";
import { getBaseUrl, getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "Hacked Wallet Recovery",
  description:
    "Recover tokens and NFTs from a compromised wallet. Scan assets by address, select what to recover, and execute a batched onchain recovery to a new safe wallet.",
  canonicalPath: "/",
});

export default function Home() {
  const baseUrl = getBaseUrl();
  const description =
    "Recover tokens and NFTs from a compromised wallet by batching transfers and executing onchain recovery to a new safe wallet.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        name: "BuidlGuidl",
        url: "https://buidlguidl.com",
      },
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        name: "Hacked Wallet Recovery",
        url: baseUrl,
        description,
        publisher: { "@id": `${baseUrl}/#organization` },
      },
      {
        "@type": "WebApplication",
        "@id": `${baseUrl}/#app`,
        name: "Hacked Wallet Recovery",
        url: baseUrl,
        description,
        applicationCategory: "SecurityApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript and a browser wallet.",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        publisher: { "@id": `${baseUrl}/#organization` },
      },
    ],
  };

  return (
    <main className="flex flex-col grow items-center justify-center">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Visible content is the wizard; keep SEO/accessibility copy in initial HTML without affecting layout. */}
      <header className="sr-only">
        <h1>Hacked wallet recovery</h1>
        <p>
          This tool helps you recover assets from a compromised wallet (tokens, NFTs, and positions). The recovery flow
          is designed so your private key stays in your browser while you select what to recover and send everything to
          a new safe wallet.
        </p>
        <nav aria-label="Learn more">
          <a href="/how-it-works">How it works</a>
          <a href="/recover/custom-calls">Custom calls</a>
        </nav>
      </header>

      <noscript>
        <div className="w-full max-w-5xl px-5 pt-8 pb-4">
          <div className="rounded-2xl border border-base-300 bg-base-100 p-4 text-sm">
            JavaScript is required to run the recovery wizard. The explanation pages still work without JavaScript:
            <div className="mt-2 flex flex-wrap gap-3">
              <a className="link" href="/how-it-works">
                How it works
              </a>
              <a className="link" href="/recover/custom-calls">
                Custom calls
              </a>
            </div>
          </div>
        </div>
      </noscript>

      <RecoverWizard />
    </main>
  );
}
