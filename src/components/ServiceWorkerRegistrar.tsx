"use client";

/**
 * Registers the minimal service worker (`/public/sw.js`) for PWA
 * installability. Mounted once by the root layout. No-op outside the browser
 * and in development.
 *
 * SHARED app-shell component. Feature agents should not edit this.
 */

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failures are non-fatal — the app still works online.
    });
  }, []);

  return null;
}
