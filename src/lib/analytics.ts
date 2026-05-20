/**
 * Client-side analytics — fires custom events to the standalone Vibhu
 * analytics Worker (Cloudflare Workers Analytics Engine). See
 * `analytics-worker/` for the Worker, its data schema, and query reference.
 *
 * The Worker URL comes from `NEXT_PUBLIC_ANALYTICS_URL` (a build variable).
 * When unset, every call is a no-op — analytics is fully optional and must
 * never block or break the app.
 */

const ANALYTICS_URL = (process.env.NEXT_PUBLIC_ANALYTICS_URL ?? "").replace(
  /\/+$/,
  "",
);

/**
 * Record a wallet-connect event. Fire-and-forget: network/CORS failures are
 * swallowed and never surface to the caller — analytics must not affect a
 * wallet connect.
 */
export function trackWalletConnect(wallet: {
  authority: string;
  kind: string;
}): void {
  if (!ANALYTICS_URL || !wallet.authority) return;
  try {
    void fetch(`${ANALYTICS_URL}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "wallet_connect",
        wallet: wallet.authority,
        walletKind: wallet.kind,
      }),
      keepalive: true,
    }).catch(() => {
      // Non-fatal — ignore network/CORS errors.
    });
  } catch {
    // `fetch` can throw synchronously in rare cases — ignore.
  }
}
