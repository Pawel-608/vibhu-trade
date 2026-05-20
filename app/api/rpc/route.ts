/**
 * Server-side Solana RPC proxy (PLAN.md §3).
 *
 * Keeps the paid RPC key off the client. `submitTransaction` (src/trading)
 * posts JSON-RPC here by default. Configure the upstream with the server-only
 * `SOLANA_RPC_URL` env var; falls back to public mainnet for local dev.
 */
import { NextRequest } from "next/server";

const UPSTREAM_RPC_URL =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();

  try {
    const upstream = await fetch(UPSTREAM_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
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
