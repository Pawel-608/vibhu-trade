"use client";

/**
 * useTradesHistory — the connected wallet's own Phoenix-perps fill history.
 *
 * Reads `GET /trader/{authority}/trades-history?limit=100` through the app's
 * same-origin proxy (`PHOENIX_API_PROXY_PATH`), wrapped in TanStack Query with
 * a 30s `refetchInterval` so the Trades tab reflects new fills without a
 * manual reload. The authority comes from the connected `AppWallet`.
 *
 * The endpoint transports `realizedPnl` / `fees` / `price` / `baseLots*` as
 * numeric strings; this hook parses them into plain numbers so the view layer
 * only ever deals with `number`.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useQuery } from "@tanstack/react-query";
import { PHOENIX_API_PROXY_PATH } from "@/lib/constants";

/** How many fills to pull. */
const TRADE_HISTORY_LIMIT = 100;
/** Auto-refresh cadence — keeps the list current with new fills. */
const REFETCH_INTERVAL_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* Raw API shape (only the fields we consume)                                 */
/* -------------------------------------------------------------------------- */

interface RawTrade {
  marketSymbol?: string;
  realizedPnl?: string;
  fees?: string;
  timestamp?: string;
  price?: string;
  instructionType?: string;
  baseLotsBefore?: string;
  baseLotsAfter?: string;
  baseLotsDelta?: string;
  liquidity?: string;
}

interface RawTradesHistory {
  data?: RawTrade[];
  hasMore?: boolean;
}

/* -------------------------------------------------------------------------- */
/* View-facing shape                                                          */
/* -------------------------------------------------------------------------- */

/** A single parsed fill, ready for rendering. */
export interface TradeHistoryRow {
  /** Stable key for the row. */
  id: string;
  marketSymbol: string;
  /** "buy" when the position grew long-side, "sell" when it grew short-side. */
  side: "buy" | "sell";
  /** Absolute fill size in base lots. */
  size: number;
  price: number;
  realizedPnl: number;
  fees: number;
  /** Epoch milliseconds. */
  timeMs: number;
  instructionType: string;
  liquidity: string;
}

/* -------------------------------------------------------------------------- */
/* Fetch + parse                                                              */
/* -------------------------------------------------------------------------- */

/** Parse a numeric string defensively — bad/missing input becomes 0. */
function toNum(v: string | number | undefined | null): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an ISO / numeric-string timestamp into epoch milliseconds. */
function toEpochMs(value: string | undefined): number {
  if (!value) return Date.now();
  const asNum = Number(value);
  if (Number.isFinite(asNum)) {
    return asNum < 1e12 ? asNum * 1000 : asNum;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseTrade(raw: RawTrade, idx: number): TradeHistoryRow {
  const delta = toNum(raw.baseLotsDelta);
  // Sign of the base-lot delta gives direction: a long-side fill grows the
  // position (positive delta) -> buy; a short-side fill -> sell. Fall back to
  // `instructionType` text when the delta is exactly zero.
  let side: "buy" | "sell";
  if (delta > 0) side = "buy";
  else if (delta < 0) side = "sell";
  else side = /sell|ask|short/i.test(raw.instructionType ?? "") ? "sell" : "buy";

  const timeMs = toEpochMs(raw.timestamp);
  return {
    id: `${raw.timestamp ?? ""}:${raw.marketSymbol ?? ""}:${idx}`,
    marketSymbol: raw.marketSymbol ?? "—",
    side,
    size: Math.abs(delta),
    price: toNum(raw.price),
    realizedPnl: toNum(raw.realizedPnl),
    fees: toNum(raw.fees),
    timeMs,
    instructionType: raw.instructionType ?? "",
    liquidity: raw.liquidity ?? "",
  };
}

async function fetchTradesHistory(authority: string): Promise<TradeHistoryRow[]> {
  const res = await fetch(
    `${PHOENIX_API_PROXY_PATH}/trader/${authority}/trades-history?limit=${TRADE_HISTORY_LIMIT}`,
    {
      headers: { accept: "application/json" },
      // Always hit the network — never serve a stale cached response.
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Could not load trade history (${res.status}).`);
  }
  const body = (await res.json()) as RawTradesHistory;
  const rows = (body.data ?? []).map(parseTrade);
  // Newest first.
  rows.sort((a, b) => b.timeMs - a.timeMs);
  return rows;
}

/**
 * Live trade history for the connected wallet. Pass the connected wallet's
 * `authority`; when `null`/`undefined` the query is disabled.
 */
export function useTradesHistory(authority: string | null | undefined) {
  return useQuery<TradeHistoryRow[]>({
    queryKey: ["trades-history", authority],
    queryFn: () => fetchTradesHistory(authority as string),
    enabled: !!authority,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
