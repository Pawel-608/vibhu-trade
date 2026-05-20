"use client";

/**
 * useMarkPrice — the latest mark price for a market, as a reference for the
 * order ticket (market-order notional, % slider, liquidation estimate).
 *
 * Uses a one-shot HTTP read of the market-stats endpoint with a short refetch
 * interval. Live orderbook / mark-price *streaming* belongs to the Market Data
 * feature; the order ticket only needs a fresh-enough reference value.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useQuery } from "@tanstack/react-query";
import { usePhoenixClient } from "@/providers/RiseClientProvider";

export interface UseMarkPriceResult {
  /** Latest mark price in USD, or `null` while loading / unavailable. */
  markPrice: number | null;
  isLoading: boolean;
}

export function useMarkPrice(symbol: string): UseMarkPriceResult {
  const client = usePhoenixClient();
  const query = useQuery({
    queryKey: ["trading", "mark-price", symbol],
    queryFn: async () => {
      const res = await client.api
        .markets()
        .getMarketStatsHistory(symbol, { limit: 1 });
      const latest = res.stats[res.stats.length - 1];
      return latest ? latest.mark_price : null;
    },
    staleTime: 5_000,
    refetchInterval: 8_000,
    retry: 1,
  });

  return {
    markPrice: query.data ?? null,
    isLoading: query.isLoading,
  };
}
