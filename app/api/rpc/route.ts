/**
 * Server-side Solana RPC proxy (PLAN.md §3).
 *
 * Keeps the paid RPC key off the client — `submitTransaction` (src/trading)
 * and the Rise client both POST JSON-RPC here. The upstream is the server-only
 * `SOLANA_RPC_URL` env var (Solana Vibe Station).
 *
 * `SOLANA_RPC_URL` must be a RUNTIME variable on the deployed Worker
 * (Cloudflare dashboard -> Variables and Secrets), NOT a build-time variable.
 * If it is missing this route fails loudly with a 503 rather than silently
 * forwarding to a public RPC — whose datacenter-IP block returns a confusing
 * 403. Hit `GET /api/rpc` for a key-safe diagnostic of what the Worker sees.
 */
import { NextRequest } from "next/server";

// Always run per-request — never statically cached, and on Cloudflare Workers
// the runtime env is bound per request.
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Resolve the upstream RPC URL from the server runtime env. Read inside the
 * handler (not at module scope) so Cloudflare's per-request env binding is in
 * place. No public-RPC fallback: a missing var is a misconfiguration we want
 * surfaced, not masked behind a misleading 403.
 */
function upstreamRpcUrl(): string | null {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    null
  );
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }),
    { status, headers: { "Content-Type": "application/json", ...NO_STORE } },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const url = upstreamRpcUrl();
  if (!url) {
    return jsonRpcError(
      503,
      -32000,
      "RPC proxy misconfigured: SOLANA_RPC_URL is not set on the server runtime.",
    );
  }

  const body = await req.text();
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...NO_STORE },
    });
  } catch (err) {
    return jsonRpcError(502, -32603, `RPC proxy error: ${String(err)}`);
  }
}

/**
 * Key-safe diagnostic: confirms whether the deployed Worker can see
 * `SOLANA_RPC_URL` at runtime. Reports only the host (the api_key querystring
 * is stripped by `URL.host`) and booleans — never the full URL or the key.
 */
export async function GET(): Promise<Response> {
  const raw = upstreamRpcUrl();
  let upstreamHost: string | null = null;
  if (raw) {
    try {
      upstreamHost = new URL(raw).host;
    } catch {
      upstreamHost = "(unparseable URL)";
    }
  }
  return new Response(
    JSON.stringify({
      ok: Boolean(raw),
      solanaRpcUrlVisible: Boolean(process.env.SOLANA_RPC_URL),
      upstreamHost,
      hint: raw
        ? "Worker can see the RPC env var."
        : "SOLANA_RPC_URL is NOT visible to the Worker runtime — add it as a runtime variable (Variables and Secrets) and redeploy.",
    }),
    { headers: { "Content-Type": "application/json", ...NO_STORE } },
  );
}
