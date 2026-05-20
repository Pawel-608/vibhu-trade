/**
 * Shared app-wide constants. SAFE for any feature agent to import; do not edit
 * unless you own configuration (skeleton owner).
 */

/** Phoenix perps HTTP API base URL (upstream — used by the /api/phoenix proxy). */
export const PHOENIX_API_URL =
  process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";

/**
 * Same-origin path that proxies the Phoenix HTTP API
 * (see `app/api/phoenix/[...path]/route.ts`).
 *
 * The browser cannot call `perp-api.phoenix.trade` directly — the API rejects
 * the CORS preflight for the Rise SDK's custom client headers. The Rise client
 * is pointed at this proxy instead; server-to-server has no CORS.
 */
export const PHOENIX_API_PROXY_PATH = "/api/phoenix";

/**
 * Phoenix perps WebSocket endpoint. WS is NOT subject to the HTTP CORS issue,
 * so streams connect directly (passed explicitly as `ws.url`).
 */
export const PHOENIX_WS_URL =
  process.env.NEXT_PUBLIC_PHOENIX_WS_URL ??
  `${PHOENIX_API_URL.replace(/^http/, "ws").replace(/\/+$/, "")}/v1/ws`;

/** Solana RPC endpoint. Empty string -> SDK falls back to its own default. */
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";

/** Privy app ID. Empty -> Privy auth is disabled, external-wallet path only. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Default market the app opens to (PLAN.md §7).
 * Symbols are bare tickers (e.g. "SOL") — the live API 404s on "SOL-PERP".
 * See API-RECON.md.
 */
export const DEFAULT_SYMBOL = "SOL";

/** Route to the main trade screen for a given market symbol. */
export const tradeRoute = (symbol: string = DEFAULT_SYMBOL): string =>
  `/trade/${encodeURIComponent(symbol)}`;

/**
 * Phoenix perps program address.
 * NOTE: Placeholder — confirm the mainnet perps program ID during Phase 0
 * (the value below is the legacy *spot* program and is NOT correct for perps).
 * The Rise SDK resolves the real address internally; this is for display only.
 */
export const PHOENIX_PROGRAM_ID_PLACEHOLDER =
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";

/**
 * Flight builder config placeholders (PLAN.md §5). The builder authority
 * keypair is created by the standalone flight-register script (owned by the
 * scripts/ agent). Fill these once the builder is registered.
 */
export const FLIGHT_BUILDER_AUTHORITY_PLACEHOLDER = "";
export const FLIGHT_BUILDER_PDA_INDEX = 0;
export const FLIGHT_BUILDER_SUBACCOUNT_INDEX = 0;

/** Whether the Privy login path is enabled (requires a configured app ID). */
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

/** Bottom-nav view identifiers for the main trade screen (PLAN.md §7). */
export const TRADE_VIEWS = ["markets", "trade", "account"] as const;
