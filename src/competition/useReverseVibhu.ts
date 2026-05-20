"use client";

/**
 * useReverseVibhu — live data for the "Reverse Vibhu Index".
 *
 * A hypothetical strategy that takes the EXACT OPPOSITE side of every one of
 * Vibhu's fills. For each fill:
 *
 *   reverted contribution = -realizedPnl - fees
 *
 * (mirroring his side flips the sign of his realized PnL; you still pay the
 * same fee). The Reverse Index starts from `CHALLENGE_START_USD` and runs the
 * cumulative sum of those contributions, oldest trade -> newest.
 *
 * Fetches Vibhu's trade history through the same-origin `/api/phoenix` proxy
 * and wraps it in TanStack Query with a 20s `refetchInterval` so the breakdown
 * page stays live like the rest of the Competition feature.
 *
 * OWNED BY: Competition feature (`src/competition/`).
 */

import { useQuery } from "@tanstack/react-query";
import { PHOENIX_API_PROXY_PATH } from "@/lib/constants";
import { CHALLENGE_START_USD, COMPETITORS } from "./useChallengeData";

/** Auto-refresh cadence — matches the rest of the Competition page. */
const REFETCH_INTERVAL_MS = 20_000;
/** How many trade-history rows to pull. */
const TRADE_HISTORY_LIMIT = 500;

/** Vibhu's wallet authority (the competitor we mirror). */
const VIBHU_AUTHORITY = COMPETITORS.find((c) => c.id === "vibhu")!.authority;

/* -------------------------------------------------------------------------- */
/* Raw API shape (only the fields we consume)                                 */
/* -------------------------------------------------------------------------- */

interface RawTrade {
  marketSymbol?: string;
  realizedPnl?: string;
  fees?: string;
  timestamp?: string;
  instructionType?: string;
  baseLotsBefore?: string;
  baseLotsAfter?: string;
}

interface RawTradesHistory {
  data?: RawTrade[];
  hasMore?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Derived / view-facing shapes                                               */
/* -------------------------------------------------------------------------- */

/** One of Vibhu's fills, mirrored. */
export interface ReverseTrade {
  /** 1-based position in the oldest-first ordering. */
  index: number;
  marketSymbol: string;
  /** ISO timestamp of the fill. */
  timestamp: string;
  instructionType: string;
  /** Vibhu's realized PnL on this fill. */
  hisRealizedPnl: number;
  /** Fee paid on this fill (we pay it too). */
  fees: number;
  /** Our contribution mirroring him: `-hisRealizedPnl - fees`. */
  revertedPnl: number;
  /** Reverse Index value AFTER applying this trade. */
  runningIndex: number;
  baseLotsBefore: number;
  baseLotsAfter: number;
}

/** Per-market rollup of the reverted strategy. */
export interface ReverseMarketBreakdown {
  marketSymbol: string;
  count: number;
  /** Sum of his realized PnL in this market. */
  hisRealizedPnl: number;
  /** Sum of fees in this market. */
  fees: number;
  /** Our reverted total: `-hisRealizedPnl - fees`. */
  revertedPnl: number;
}

/** The single biggest-impact reverted trade, with its surrounding context. */
export interface KeyInsight {
  /** The trade whose `revertedPnl` has the largest magnitude. */
  trade: ReverseTrade;
  /** Reverse Index value immediately BEFORE that trade. */
  indexBefore: number;
}

/** Fully derived Reverse Vibhu Index data. */
export interface ReverseVibhuData {
  /** Per-trade rows, oldest -> newest. */
  trades: ReverseTrade[];
  /** Number of fills. */
  tradeCount: number;
  /** Sum of Vibhu's realized PnL across all fills. */
  hisGrossRealizedPnl: number;
  /** Sum of all fees. */
  totalFees: number;
  /** Final Reverse Index value (start + Σ reverted contributions). */
  finalIndex: number;
  /** Net PnL of the reverted strategy: `finalIndex - CHALLENGE_START_USD`. */
  netPnl: number;
  /** The starting balance the index is built from. */
  startUsd: number;
  /** Per-market reverted breakdown, biggest |revertedPnl| first. */
  markets: ReverseMarketBreakdown[];
  /** The single trade that dominates the result (or null if no trades). */
  keyInsight: KeyInsight | null;
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

async function fetchTradesHistory(): Promise<RawTradesHistory> {
  const res = await fetch(
    `${PHOENIX_API_PROXY_PATH}/trader/${VIBHU_AUTHORITY}/trades-history?limit=${TRADE_HISTORY_LIMIT}`,
    {
      headers: { accept: "application/json" },
      // Always hit the network — never serve a stale cached response.
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Phoenix request failed (${res.status})`);
  }
  return (await res.json()) as RawTradesHistory;
}

/** Turn a raw trades-history payload into the derived Reverse Index data. */
function deriveReverseVibhu(history: RawTradesHistory): ReverseVibhuData {
  // Sort oldest -> newest so the running index builds chronologically.
  const raw = [...(history.data ?? [])].sort((a, b) => {
    const ta = Date.parse(a.timestamp ?? "");
    const tb = Date.parse(b.timestamp ?? "");
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  const trades: ReverseTrade[] = [];
  const marketMap = new Map<string, ReverseMarketBreakdown>();

  let hisGrossRealizedPnl = 0;
  let totalFees = 0;
  let runningIndex = CHALLENGE_START_USD;

  raw.forEach((t, i) => {
    const hisRealizedPnl = toNum(t.realizedPnl);
    const fees = toNum(t.fees);
    // Mirror his side: his realized PnL flips sign, we still pay the fee.
    const revertedPnl = -hisRealizedPnl - fees;

    hisGrossRealizedPnl += hisRealizedPnl;
    totalFees += fees;
    runningIndex += revertedPnl;

    const symbol = t.marketSymbol ?? "—";
    trades.push({
      index: i + 1,
      marketSymbol: symbol,
      timestamp: t.timestamp ?? "",
      instructionType: t.instructionType ?? "—",
      hisRealizedPnl,
      fees,
      revertedPnl,
      runningIndex,
      baseLotsBefore: toNum(t.baseLotsBefore),
      baseLotsAfter: toNum(t.baseLotsAfter),
    });

    const existing = marketMap.get(symbol);
    if (existing) {
      existing.count += 1;
      existing.hisRealizedPnl += hisRealizedPnl;
      existing.fees += fees;
      existing.revertedPnl += revertedPnl;
    } else {
      marketMap.set(symbol, {
        marketSymbol: symbol,
        count: 1,
        hisRealizedPnl,
        fees,
        revertedPnl,
      });
    }
  });

  const finalIndex = runningIndex;
  const netPnl = finalIndex - CHALLENGE_START_USD;

  const markets = [...marketMap.values()].sort(
    (a, b) => Math.abs(b.revertedPnl) - Math.abs(a.revertedPnl),
  );

  // Key insight: the single trade with the largest-magnitude reverted
  // contribution, plus the index value just before it.
  let keyInsight: KeyInsight | null = null;
  let biggest: ReverseTrade | null = null;
  for (const tr of trades) {
    if (!biggest || Math.abs(tr.revertedPnl) > Math.abs(biggest.revertedPnl)) {
      biggest = tr;
    }
  }
  if (biggest) {
    keyInsight = {
      trade: biggest,
      indexBefore: biggest.runningIndex - biggest.revertedPnl,
    };
  }

  return {
    trades,
    tradeCount: trades.length,
    hisGrossRealizedPnl,
    totalFees,
    finalIndex,
    netPnl,
    startUsd: CHALLENGE_START_USD,
    markets,
    keyInsight,
  };
}

/**
 * Live Reverse Vibhu Index data. Auto-refreshes every 20s so the breakdown
 * page reflects new fills without a manual reload.
 */
export function useReverseVibhu() {
  return useQuery<ReverseVibhuData>({
    queryKey: ["competition", "reverse-vibhu"],
    queryFn: async () => deriveReverseVibhu(await fetchTradesHistory()),
    refetchInterval: REFETCH_INTERVAL_MS,
    // Keep polling even when the tab is backgrounded, and treat data as
    // always-stale so every mount / window-focus also pulls fresh.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
