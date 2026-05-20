"use client";

/**
 * useMarkets — market-list data for the MarketSelector / header.
 *
 * One-shot HTTP read (`client.api.markets().getMarkets()`) wrapped in
 * TanStack Query for the static config (symbol, tick size, decimals, status).
 * Live prices come from the SDK market-data store (WS `allMids` +
 * `marketStats` + `markPrice`), surfaced via `useMarketDataRow` per symbol
 * with a leaf selector so a tick re-renders one cell (PLAN.md §3).
 *
 * The SDK's live stores are zustand `StoreApi` instances. zustand is only a
 * transitive dependency of the SDK, not an app dependency, so we subscribe to
 * those stores with React's built-in `useSyncExternalStore` rather than
 * importing `zustand` directly.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  selectMarketDataRow,
  type ApiCandle,
  type ExchangeMarketConfig,
  type PhoenixMarketData,
  type PhoenixMarketDataRow,
} from "@ellipsis-labs/rise";
import { usePhoenixClient } from "@/providers/RiseClientProvider";

/** Static market config list — cached aggressively (rarely changes). */
export function useMarketConfigs() {
  const client = usePhoenixClient();
  return useQuery<ExchangeMarketConfig[]>({
    queryKey: ["markets", "configs"],
    queryFn: () => client.api.markets().getMarkets(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/** Single market config — used by the header for tick size / decimals. */
export function useMarketConfig(symbol: string) {
  const client = usePhoenixClient();
  return useQuery<ExchangeMarketConfig>({
    queryKey: ["markets", "config", symbol],
    queryFn: () => client.api.markets().getMarket(symbol),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: symbol.length > 0,
  });
}

/**
 * The shared SDK market-data manager — backs live mids / mark price / stats
 * for every symbol via WS `allMids`, `markPrice`, and `marketStats`. Retained
 * for the lifetime of the consuming component so the WS stays subscribed.
 */
export function useMarketDataManager(): PhoenixMarketData {
  const client = usePhoenixClient();
  const manager = useMemo(() => client.marketData(), [client]);

  useEffect(() => {
    const release = manager.retain();
    return release;
  }, [manager]);

  return manager;
}

/**
 * Subscribe to a zustand `StoreApi` via `useSyncExternalStore` with a
 * memoized leaf selector. `selectMarketDataRow` returns a stable reference
 * (the same row object) until that symbol's data actually changes, so this
 * does not re-render on unrelated symbols' ticks.
 */
/** Shallow value-equality so an unchanged slice keeps a stable reference. */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  ) {
    return false;
  }
  const ak = a as Record<string, unknown>;
  const bk = b as Record<string, unknown>;
  const keys = Object.keys(ak);
  if (keys.length !== Object.keys(bk).length) return false;
  return keys.every((k) => Object.is(ak[k], bk[k]));
}

/**
 * Subscribe to an SDK zustand `StoreApi` with a leaf selector.
 *
 * Uses `useState` + `useEffect` rather than `useSyncExternalStore`: the SDK
 * selector allocates a fresh object each call, which makes
 * `useSyncExternalStore` report "getSnapshot should be cached / infinite
 * loop". Here a re-render happens only when the selected slice actually
 * changes (`shallowEqual`). Pass a STABLE (memoized) selector.
 */
function useStoreSelector<TState, TSlice>(
  store: { getState: () => TState; subscribe: (cb: () => void) => () => void },
  selector: (state: TState) => TSlice,
): TSlice {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [slice, setSlice] = useState<TSlice>(() => selector(store.getState()));

  useEffect(() => {
    const read = () => {
      const next = selectorRef.current(store.getState());
      // Returning `prev` when unchanged makes React skip the re-render, so a
      // store tick for an unrelated symbol costs nothing.
      setSlice((prev) => (shallowEqual(prev, next) ? prev : next));
    };
    read(); // catch up to any change between render and subscribe
    return store.subscribe(read);
  }, [store, selector]);

  return slice;
}

/**
 * Leaf selector into the SDK market-data store for one symbol. A price tick
 * for SOL only re-renders components selecting SOL (PLAN.md §3).
 */
export function useMarketDataRow(
  symbol: string,
): PhoenixMarketDataRow | undefined {
  const manager = useMarketDataManager();
  const selector = useMemo(() => selectMarketDataRow(symbol), [symbol]);
  return useStoreSelector(manager.store, selector);
}

/* ------------------------------------------------------------------ */
/* 24h change — computed from hourly candles.                          */
/*                                                                     */
/* The SDK's `PhoenixMarketDataRow.priceChange24hPercent` is derived    */
/* from the `marketStats` WS `prevDayMarkPrice` field, which is         */
/* unreliable — it produces wildly wrong swings (e.g. +30–70% for a     */
/* flat market) and the REST `/market/{sym}/stats` endpoint carries no  */
/* change field at all. We instead compute a genuine rolling-24h change */
/* from ~25 hourly (`1h`) candles: the latest close vs. the close ~24h  */
/* earlier. Returned as a RATIO (0.0123 == +1.23%), matching what       */
/* `fmtPercent` expects.                                               */
/* ------------------------------------------------------------------ */

/** Hourly candles to fetch: 24 buckets back + current, with slack. */
const CHANGE_CANDLE_LIMIT = 26;
/** How far back (in candles) to look for the "24h ago" reference close. */
const CHANGE_LOOKBACK = 24;

/**
 * Compute a rolling-24h change ratio from hourly candles.
 *
 * Candles may arrive in any order; we sort ascending by time, take the last
 * close as "now" and the close ~24 buckets earlier as the reference. Returns
 * `null` when there is not enough data or the reference is non-positive.
 */
function changeRatioFromCandles(candles: ApiCandle[] | undefined): number | null {
  if (!candles || candles.length < 2) return null;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const latest = sorted[sorted.length - 1];
  // Prefer the candle exactly CHANGE_LOOKBACK buckets back; if the series is
  // shorter, fall back to the oldest candle we have.
  const refIndex = Math.max(0, sorted.length - 1 - CHANGE_LOOKBACK);
  const reference = sorted[refIndex];
  const latestClose = latest.close;
  const refClose = reference.close;
  if (!Number.isFinite(latestClose) || !Number.isFinite(refClose)) return null;
  if (refClose <= 0) return null;
  return (latestClose - refClose) / refClose;
}

/** Query options for one symbol's hourly 24h-change candles. */
function changeQueryConfig(
  client: ReturnType<typeof usePhoenixClient>,
  symbol: string,
) {
  return {
    queryKey: ["candles", "change-24h", symbol] as const,
    queryFn: () =>
      client.api
        .candles()
        .getCandles(symbol, { timeframe: "1h", limit: CHANGE_CANDLE_LIMIT }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    enabled: symbol.length > 0,
  };
}

/**
 * Correct rolling-24h price change for a single symbol, as a ratio
 * (0.0123 == +1.23%). Computed from hourly candles — see note above.
 */
export function use24hChange(symbol: string): number | null {
  const client = usePhoenixClient();
  const { data } = useQuery<ApiCandle[]>(changeQueryConfig(client, symbol));
  return useMemo(() => changeRatioFromCandles(data), [data]);
}

/**
 * Correct rolling-24h change ratios for many symbols at once, returned as a
 * `symbol -> ratio` map. Used by the market selector so its rows and its
 * change-sort agree. Each symbol is an independently cached query, so this is
 * cheap to call repeatedly and shares cache with `use24hChange`.
 */
export function use24hChangeMap(
  symbols: readonly string[],
  enabled = true,
): ReadonlyMap<string, number | null> {
  const client = usePhoenixClient();
  const queries = useQueries({
    queries: (enabled ? symbols : []).map((symbol) => ({
      ...changeQueryConfig(client, symbol),
    })),
  });

  return useMemo(() => {
    const map = new Map<string, number | null>();
    const active = enabled ? symbols : [];
    active.forEach((symbol, i) => {
      map.set(symbol, changeRatioFromCandles(queries[i]?.data));
    });
    return map;
    // `queries` identity changes each render; depend on the data slices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, symbols, ...queries.map((q) => q.data)]);
}

/** Re-exported so other market-data components can subscribe to SDK stores. */
export { useStoreSelector };
