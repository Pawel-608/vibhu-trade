/*
 * Minimal service worker for Phoenix Mobile (PWA installability).
 *
 * Intentionally tiny: it only enables "Add to Home Screen" and a network-first
 * fetch with no real offline caching. Trading data must never be served stale,
 * so API/WS traffic is left untouched. Replace with a proper offline-shell
 * strategy (e.g. next-pwa / Workbox) during Phase 4 (PLAN.md §8).
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass through — no caching yet.
});
