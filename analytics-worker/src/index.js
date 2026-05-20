/**
 * Vibhu analytics — a standalone Cloudflare Worker that records custom events
 * (currently: wallet connects) into Workers Analytics Engine.
 *
 * Kept SEPARATE from the main Vibhu app (Next.js / OpenNext) on purpose: a
 * plain Worker uses an Analytics Engine binding natively with no adapter
 * plumbing, and this cannot affect the main app's deploy.
 *
 * Binding (see wrangler.toml / dashboard): `AE` -> dataset `vibhu_events`.
 *
 * Data-point schema:
 *   index1  = wallet address  -> count(DISTINCT index1) = distinct wallets
 *   blob1   = event name      ("wallet_connect")
 *   blob2   = wallet kind     ("privy-embedded" | "external")
 *   blob3   = country         (from request.cf)
 *   double1 = 1               (one row per event)
 *
 * Query it with the Analytics Engine SQL API — see README.md.
 */

const ALLOWED_ORIGINS = new Set([
  "https://vibhu.trade",
  "https://www.vibhu.trade",
  "https://phoenix-mobile.solanaquaymarkets.workers.dev",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsHeaders(origin) {
  const allow =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://vibhu.trade";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/track") {
      return new Response("Not found", { status: 404, headers: cors });
    }

    // Soft anti-spam: only accept browser requests from known origins.
    // (Origin is absent for non-browser clients; those are allowed through.)
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response("Forbidden origin", { status: 403, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400, headers: cors });
    }

    const event = String(body.event ?? "").slice(0, 64);
    const wallet = String(body.wallet ?? "").slice(0, 64);
    const walletKind = String(body.walletKind ?? "").slice(0, 32);
    if (!event || !wallet) {
      return new Response("Missing event or wallet", {
        status: 400,
        headers: cors,
      });
    }

    const country = (request.cf && request.cf.country) || "unknown";

    env.AE.writeDataPoint({
      indexes: [wallet], // index1 — count(DISTINCT index1) = distinct wallets
      blobs: [event, walletKind, String(country)],
      doubles: [1],
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...cors },
    });
  },
};
