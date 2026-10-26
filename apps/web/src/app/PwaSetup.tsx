"use client";

import { useEffect } from "react";

// Registers the offline-page service worker and reports installs (P1-W5-S06).
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("service worker registration failed", error);
      });
    }
    const installed = () => {
      fetch("/api/pwa-installed", { method: "POST" })
        .then((response) => {
          if (!response.ok) {
            console.error("pwa_installed report failed", response.status);
          }
        })
        .catch((error: unknown) => {
          console.error("pwa_installed report failed", error);
        });
    };
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return null;
}
