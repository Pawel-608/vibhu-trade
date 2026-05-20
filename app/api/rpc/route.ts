/**
 * Server-side Solana RPC proxy (PLAN.md §3).
 *
 * Keeps the paid RPC key off the client — `submitTransaction` (src/trading) and
 * the Rise client both POST JSON-RPC here. The upstream is the server-only
 * `SOLANA_RPC_URL` env var (Solana Vibe Station); falls back to public mainnet
 * only if it is unset.
 */
import { NextRequest } from "next/server";

// Always run per-request — never statically cached.
export const dynamic = "force-dynamic";

/**
 * Resolve the upstream RPC URL.
 *
 * IMPORTANT: read this INSIDE the request handler, never at module scope. On
 * Cloudflare Workers (OpenNext) the runtime env is bound per-request, so a
 * module-level `process.env` read runs before the env exists and silently bakes
 * in the public-mainnet fallback — which then 403s datacenter IPs in prod.
 */
function upstreamRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();

  try {
    const upstream = await fetch(upstreamRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: `RPC proxy error: ${String(err)}` },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
