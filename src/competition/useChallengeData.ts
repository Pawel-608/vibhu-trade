"use client";

/**
 * useChallengeData — live data for the Vibhu vs Drew trading challenge.
 *
 * Reads two public Phoenix endpoints per wallet through the app's same-origin
 * proxy (`/api/phoenix/...`), wrapped in TanStack Query with a 20s
 * `refetchInterval` so the Competition page stays live:
 *
 *  - `GET /trader/{authority}/state`               -> account value, positions
 *  - `GET /trader/{authority}/trades-history?limit` -> realized PnL, fees
 *
 * All numeric figures arrive as strings; parsing happens here so the view
 * layer only deals with plain numbers.
 *
 * OWNED BY: Competition feature (`src/competition/`).
 */

import { useQuery } from "@tanstack/react-query";
import { PHOENIX_API_PROXY_PATH } from "@/lib/constants";

/** Assumed starting balance per trader — both began at roughly this. */
export const CHALLENGE_START_USD = 10_000;

/** Auto-refresh cadence for the live challenge data. */
const REFETCH_INTERVAL_MS = 20_000;
/** How many trade-history rows to pull per wallet. */
const TRADE_HISTORY_LIMIT = 500;

/** The two competitors, keyed by a stable id. */
export const COMPETITORS = [
  { id: "vibhu", name: "Vibhu", authority: "M9xLFEM3q7EhF61aWj5PRvft77KbpW4M6q8j5cDHeA7" },
  { id: "drew", name: "Drew", authority: "AWK785JofvzZX6meFM6a9gTvLuGXSwt5pUuKVMswC2aS" },
] as const;

export type CompetitorId = (typeof COMPETITORS)[number]["id"];

/* -------------------------------------------------------------------------- */
/* Raw API shapes (only the fields we consume)                                */
/* -------------------------------------------------------------------------- */

interface ScaledValue {
  value: number;
  decimals: number;
  /** Pre-formatted decimal string, e.g. "6333.833500". */
  ui: string;
}

interface RawTraderSubaccount {
  traderSubaccountIndex?: number;
  riskState?: string;
  collateralBalance?: ScaledValue;
  portfolioValue?: ScaledValue;
  unrealizedPnl?: ScaledValue;
  positions?: RawPosition[];
  limitOrders?: Record<string, unknown>;
}

/** Positions are rendered defensively — both wallets are currently flat. */
export type RawPosition = Record<string, unknown>;

interface RawState {
  slot?: number;
  authority?: string;
  pdaIndex?: number;
  traders?: RawTraderSubaccount[];
}

interface RawTrade {
  marketSymbol?: string;
  realizedPnl?: string;
  fees?: string;
  timestamp?: string;
  price?: string;
  liquidity?: string;
  instructionType?: string;
}

interface RawTradesHistory {
  data?: RawTrade[];
  hasMore?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Derived / view-facing shapes                                               */
/* -------------------------------------------------------------------------- */

/** An open position with whatever fields the API surfaced, plus subaccount PnL. */
export interface OpenPosition {
  /** Subaccount this position belongs to. */
  subaccountIndex?: number;
  /** Unrealized PnL string for the owning subaccount. */
  subaccountUnrealizedPnlUi?: string;
  /** Raw position fields, surfaced defensively. */
  raw: RawPosition;
}

/** Per-market realized-PnL rollup. */
export interface MarketBreakdown {
  marketSymbol: string;
  count: number;
  realizedPnL: number;
  fees: number;
}

/** Fully derived stats for one competitor. */
export interface CompetitorStats {
  id: CompetitorId;
  name: string;
  authority: string;
  /** Sum of `portfolioValue.ui` across all subaccounts. */
  accountValue: number;
  /** Flattened open positions across subaccounts. */
  positions: OpenPosition[];
  /** Number of trade-history rows. */
  tradeCount: number;
  /** Sum of `realizedPnl`. */
  grossRealizedPnL: number;
  /** Sum of `fees`. */
  totalFees: number;
  /** `grossRealizedPnL - totalFees`. */
  netRealizedPnL: number;
  /** Return vs the assumed `CHALLENGE_START_USD` baseline, as a ratio. */
  returnRatio: number;
  /** Per-market rollup, biggest |PnL| first. */
  markets: MarketBreakdown[];
}

/** The whole challenge, with the leader resolved. */
export interface ChallengeData {
  competitors: CompetitorStats[];
  /** Competitor with the higher account value. */
  leader: CompetitorStats;
  /** The trailing competitor. */
  trailer: CompetitorStats;
  /** Account-value gap between leader and trailer (>= 0). */
  gap: number;
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PHOENIX_API_PROXY_PATH}${path}`, {
    headers: { accept: "application/json" },
    // Always hit the network — never serve a stale cached response.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Phoenix request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Compute derived stats for one competitor from its raw API payloads. */
function deriveStats(
  competitor: (typeof COMPETITORS)[number],
  state: RawState,
  history: RawTradesHistory,
): CompetitorStats {
  const traders = state.traders ?? [];

  const accountValue = traders.reduce(
    (sum, t) => sum + toNum(t.portfolioValue?.ui),
    0,
  );

  const positions: OpenPosition[] = traders.flatMap((t) =>
    (t.positions ?? []).map((raw) => ({
      subaccountIndex: t.traderSubaccountIndex,
      subaccountUnrealizedPnlUi: t.unrealizedPnl?.ui,
      raw,
    })),
  );

  const trades = history.data ?? [];
  const tradeCount = trades.length;

  let grossRealizedPnL = 0;
  let totalFees = 0;
  const marketMap = new Map<string, MarketBreakdown>();

  for (const trade of trades) {
    const pnl = toNum(trade.realizedPnl);
    const fee = toNum(trade.fees);
    grossRealizedPnL += pnl;
    totalFees += fee;

    const symbol = trade.marketSymbol ?? "—";
    const existing = marketMap.get(symbol);
    if (existing) {
      existing.count += 1;
      existing.realizedPnL += pnl;
      existing.fees += fee;
    } else {
      marketMap.set(symbol, {
        marketSymbol: symbol,
        count: 1,
        realizedPnL: pnl,
        fees: fee,
      });
    }
  }

  const netRealizedPnL = grossRealizedPnL - totalFees;
  const markets = [...marketMap.values()].sort(
    (a, b) => Math.abs(b.realizedPnL) - Math.abs(a.realizedPnL),
  );

  return {
    id: competitor.id,
    name: competitor.name,
    authority: competitor.authority,
    accountValue,
    positions,
    tradeCount,
    grossRealizedPnL,
    totalFees,
    netRealizedPnL,
    returnRatio: (accountValue - CHALLENGE_START_USD) / CHALLENGE_START_USD,
    markets,
  };
}

/** Fetch + derive everything for a single competitor. */
async function fetchCompetitor(
  competitor: (typeof COMPETITORS)[number],
): Promise<CompetitorStats> {
  const [state, history] = await Promise.all([
    fetchJson<RawState>(`/trader/${competitor.authority}/state`),
    fetchJson<RawTradesHistory>(
      `/trader/${competitor.authority}/trades-history?limit=${TRADE_HISTORY_LIMIT}`,
    ),
  ]);
  return deriveStats(competitor, state, history);
}

/** Fetch the whole challenge and resolve the leader. */
async function fetchChallenge(): Promise<ChallengeData> {
  const competitors = await Promise.all(COMPETITORS.map(fetchCompetitor));
  const sorted = [...competitors].sort(
    (a, b) => b.accountValue - a.accountValue,
  );
  const leader = sorted[0];
  const trailer = sorted[sorted.length - 1];
  return {
    competitors,
    leader,
    trailer,
    gap: leader.accountValue - trailer.accountValue,
  };
}

/**
 * Live challenge data. Auto-refreshes every 20s so the Competition page
 * reflects new fills without a manual reload.
 */
export function useChallengeData() {
  return useQuery<ChallengeData>({
    queryKey: ["competition", "challenge"],
    queryFn: fetchChallenge,
    refetchInterval: REFETCH_INTERVAL_MS,
    // Keep polling even when the tab is backgrounded, and treat data as
    // always-stale so every mount / window-focus also pulls fresh.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
