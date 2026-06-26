import type { Metadata } from "next";

function stripTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function withProtocol(hostOrUrl: string) {
  if (/^https?:\/\//i.test(hostOrUrl)) return hostOrUrl;
  // Vercel env vars are often hostnames like "my-app.vercel.app"
  return `https://${hostOrUrl}`;
}

export function getBaseUrl() {
  // Prefer explicit config for self-hosting/custom domains.
  const explicit =
    process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (explicit) return stripTrailingSlash(withProtocol(explicit));

  // Vercel-provided env vars.
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return stripTrailingSlash(withProtocol(vercelProd));
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return stripTrailingSlash(withProtocol(vercelUrl));

  // Local dev fallback.
  return `http://localhost:${process.env.PORT || 3000}`;
}

const baseUrl = getBaseUrl();
const titleTemplate = "%s | Hacked Wallet Recovery";

export const getMetadata = ({
  title,
  description,
  imageRelativePath = "/thumbnail.jpg",
  canonicalPath,
  noIndex,
}: {
  title: string;
  description: string;
  imageRelativePath?: string;
  canonicalPath?: `/${string}` | "/";
  noIndex?: boolean;
}): Metadata => {
  const imageUrl = `${baseUrl}${imageRelativePath}`;
  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv ? vercelEnv === "production" : process.env.NODE_ENV === "production";
  const isIndexable = isProduction && !baseUrl.includes("localhost") && !noIndex;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: titleTemplate,
    },
    description: description,
    alternates: canonicalPath ? { canonical: canonicalPath } : undefined,
    robots: isIndexable
      ? {
          index: true,
          follow: true,
        }
      : {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        },
    openGraph: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      url: canonicalPath ? new URL(canonicalPath, baseUrl).toString() : baseUrl,
      siteName: "Hacked Wallet Recovery",
      type: "website",
      locale: "en_US",
      images: [
        {
          url: imageUrl,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [imageUrl],
    },
    icons: {
      icon: [
        {
          url: "/hwr.svg",
          type: "image/svg+xml",
          media: "(prefers-color-scheme: dark)",
        },
        {
          url: "/hwr-dark.svg",
          type: "image/svg+xml",
          media: "(prefers-color-scheme: light)",
        },
        {
          url: "/favicon.png",
          sizes: "32x32",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
  };
};
