import type { MetadataRoute } from "next";

// Installable PWA (§4.2, Q-P1-31). Placeholder icon until a design pass (owner,
// 2026-10-26). Served by app/manifest.webmanifest/route.ts, not Next's manifest file,
// so the layout can link it with credentials.
export function manifest(): MetadataRoute.Manifest {
  return {
    name: "Interval",
    short_name: "Interval",
    description: "Engineering reading that fits your breaks.",
    start_url: "/",
    display: "standalone",
    theme_color: "#1f2933",
    background_color: "#1f2933",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
