"use client";

/**
 * useTraderAccount — the connected trader's live perps account for the trading
 * feature (order entry, positions, open orders).
 *
 * Strategy (mirrors the Account agent's `useTraderState`, kept local so the two
 * feature directories stay independent — CONTRACTS.md §2):
 *  - One-shot rich snapshot via `client.api.traders().getTraderState(authority)`.
 *    The returned `TraderView` carries the SDK's pre-computed derived fields
 *    (positions with `liquidationPrice` / `unrealizedPnl`, `limitOrders`,
 *    margin totals, `riskTier`) so the UI never re-implements the margin engine.
 *  - Live freshness via the WS `traderState` stream — each inbound update
 *    invalidates the query so the rich snapshot re-fetches.
 *
 * Account-state detection (trading is invite-gated, needs a registered trader):
 *  - `not-connected`  — no wallet.
 *  - `loading`        — first snapshot in flight.
 *  - `not-registered` — wallet connected but the authority has no trader account.
 *  - `error`          — snapshot fetch failed.
 *  - `ready`          — a `TraderView` is available.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PhoenixClient, TraderView } from "@ellipsis-labs/rise";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useWallet } from "@/wallet/WalletProvider";

/** The trader PDA index the trading feature operates on (cross-margin primary). */
export const TRADER_PDA_INDEX = 0;

export type TraderAccountStatus =
  | "not-connected"
  | "loading"
  | "not-registered"
  | "error"
  | "ready";

export interface UseTraderAccountResult {
  /** Coarse account state for gating the UI. */
  status: TraderAccountStatus;
  /** The connected authority (Solana pubkey), or `undefined`. */
  authority: string | undefined;
  /** The rich live trader snapshot, or `null` until ready. */
  view: TraderView | null;
  /** Raw query error, if any. */
  error: Error | null;
  /** Force a snapshot re-fetch. */
  refetch: () => void;
}

function traderAccountKey(authority: string | undefined) {
  return ["trading", "trader-account", authority ?? "none"] as const;
}

async function fetchTraderView(
  client: PhoenixClient,
  authority: string,
): Promise<TraderView | null> {
  const res = await client.api
    .traders()
    .getTraderState(authority, { pdaIndex: TRADER_PDA_INDEX });
  // A not-yet-registered authority reports no traders.
  return res.traders.length > 0 ? res.traders[0] : null;
}

export function useTraderAccount(): UseTraderAccountResult {
  const client = usePhoenixClient();
  const queryClient = useQueryClient();
  const { wallet } = useWallet();
  const authority =
    wallet?.isConnected && wallet.authority ? wallet.authority : undefined;

  const query = useQuery({
    queryKey: traderAccountKey(authority),
    enabled: !!authority,
    queryFn: () => fetchTraderView(client, authority as string),
    staleTime: 5_000,
    retry: 1,
  });

  // Live updates: re-fetch the rich snapshot when the WS reports a change.
  useEffect(() => {
    const streams = client.streams;
    if (!authority || !streams) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        for await (const _update of streams.traderState(
          authority,
          TRADER_PDA_INDEX,
          controller.signal,
        )) {
          if (cancelled) break;
          queryClient.invalidateQueries({
            queryKey: traderAccountKey(authority),
          });
        }
      } catch {
        // Stream aborted or errored — the polling staleTime keeps data fresh.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authority, client, queryClient]);

  const view = query.data ?? null;

  let status: TraderAccountStatus;
  if (!authority) {
    status = "not-connected";
  } else if (query.isLoading) {
    status = "loading";
  } else if (query.isError) {
    status = "error";
  } else if (view === null) {
    status = "not-registered";
  } else {
    status = "ready";
  }

  return {
    status,
    authority,
    view,
    error: (query.error as Error) ?? null,
    refetch: () => query.refetch(),
  };
}

/**
 * Resolve a market snapshot from the exchange metadata cache. Returns `null`
 * until the exchange metadata has loaded — callers should treat that as loading.
 */
export function useMarketSnapshot(symbol: string) {
  const client = usePhoenixClient();
  const query = useQuery({
    queryKey: ["trading", "market", symbol],
    queryFn: async () => {
      await client.exchange.ready();
      return client.exchange.market(symbol) ?? null;
    },
    staleTime: 60_000,
  });
  return query;
}
