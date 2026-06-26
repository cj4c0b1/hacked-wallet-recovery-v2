import type { MetadataRoute } from "next";

// Web app manifest (served at /manifest.webmanifest and auto-linked by Next.js).
// Standard fields so the app is installable and themed correctly on mobile.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hacked Wallet Recovery",
    short_name: "Wallet Recovery",
    description: "Recover tokens and NFTs from a compromised wallet to a new safe wallet.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    icons: [
      {
        src: "/hwr.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
      {
        src: "/favicon.png",
        type: "image/png",
        sizes: "32x32",
      },
      {
        src: "/apple-touch-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  };
}
