import type { MetadataRoute } from "next";
import { getBaseUrl } from "~~/utils/scaffold-eth/getMetadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();

  const routes: Array<{ path: string; changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/", changeFrequency: "weekly" },
    { path: "/how-it-works", changeFrequency: "monthly" },
    { path: "/recover/custom-calls", changeFrequency: "monthly" },
  ];

  return routes.map(r => ({
    url: new URL(r.path, baseUrl).toString(),
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.path === "/" ? 1 : 0.6,
  }));
}
