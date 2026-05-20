/**
 * Same-origin proxy for the Phoenix perps HTTP API.
 *
 * The browser cannot call `perp-api.phoenix.trade` directly: the API allows
 * simple cross-origin GETs but REJECTS the CORS preflight for custom request
 * headers — and the Rise SDK attaches a custom client-identity header to every
 * request. Server-to-server has no CORS, so all SDK HTTP traffic is routed
 * through this proxy. (WebSockets are not affected and connect directly.)
 *
 * Routes `/api/phoenix/<path>?<query>` -> `${PHOENIX_API_URL}/<path>?<query>`.
 */
import { NextRequest } from "next/server";
import { PHOENIX_API_URL } from "@/lib/constants";

// A proxy must never be statically cached — run on every request.
export const dynamic = "force-dynamic";

const STRIP_REQUEST_HEADERS = ["host", "connection", "accept-encoding", "content-length"];

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${PHOENIX_API_URL}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  for (const h of STRIP_REQUEST_HEADERS) headers.delete(h);

  // `no-store` so live data (positions, PnL, prices) is never served stale
  // from an HTTP cache.
  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    const respHeaders = new Headers({ "cache-control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) respHeaders.set("content-type", contentType);
    return new Response(body, { status: upstream.status, headers: respHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "phoenix_proxy_error", message: String(err) }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
