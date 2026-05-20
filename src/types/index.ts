/**
 * Shared application types.
 *
 * These are app-level types (UI / domain glue) — NOT the Rise SDK's wire
 * types. Import the SDK's own exported types directly from
 * `@ellipsis-labs/rise` for API/WS payloads. Add cross-feature types here so
 * all four feature agents share one definition.
 *
 * SAFE for any feature agent to import. Do not edit unless adding a genuinely
 * cross-cutting type (coordinate via CONTRACTS.md).
 */

import type { TRADE_VIEWS } from "@/lib/constants";

/** The three bottom-nav views of the main trade screen (PLAN.md §7). */
export type TradeView = (typeof TRADE_VIEWS)[number];

/** Order side. */
export type Side = "long" | "short";

/** Supported v1 order types (conditional orders are v2 — PLAN.md §6). */
export type OrderType = "market" | "limit";

/** Margin mode for a position (PLAN.md §6). */
export type MarginMode = "cross" | "isolated";

/** A market symbol such as "SOL-PERP". */
export type Symbol = string;

/**
 * Minimal market summary for the market selector / header. Feature agents may
 * widen this from the SDK's market snapshot type as needed within their dir.
 */
export interface MarketSummary {
  symbol: Symbol;
  /** Display-formatted mark price. */
  markPrice: string;
  /** 24h change in basis points (integer — float-free, see lib/format). */
  change24hBps: number;
}

/** Coarse async-resource status used by skeleton/error UI. */
export type LoadStatus = "idle" | "loading" | "ready" | "error";

/** Generic toast/notification surfaced after a transaction (PLAN.md §7). */
export interface AppToast {
  id: string;
  kind: "success" | "error" | "info" | "pending";
  message: string;
}

/** Result of submitting a Solana transaction through the app. */
export interface TxResult {
  signature: string;
  confirmed: boolean;
}
