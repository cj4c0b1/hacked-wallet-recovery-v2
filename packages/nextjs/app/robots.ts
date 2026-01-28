import type { MetadataRoute } from "next";
import { getBaseUrl } from "~~/utils/scaffold-eth/getMetadata";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();
  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv ? vercelEnv === "production" : process.env.NODE_ENV === "production";
  const isIndexable = isProduction && !baseUrl.includes("localhost");

  return {
    host: baseUrl,
    sitemap: `${baseUrl}/sitemap.xml`,
    rules: isIndexable
      ? [
          {
            userAgent: "*",
            allow: "/",
            disallow: ["/debug", "/blockexplorer"],
          },
        ]
      : [
          {
            userAgent: "*",
            disallow: "/",
          },
        ],
  };
}
