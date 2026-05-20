"use client";

/**
 * useTraderState — the connected trader's perps account snapshot.
 *
 * Strategy:
 *  - One-shot rich snapshot via `client.api.traders().getTraderState(authority)`
 *    (TanStack Query). The `TraderView` it returns carries the SDK's
 *    pre-computed derived fields — equity (`portfolioValue`), `unrealizedPnl`,
 *    `maintenanceMargin`, `initialMargin`, `collateralBalance` — so the UI does
 *    not redo margin math.
 *  - Live freshness via the WS `traderState` stream
 *    (`client.streams.traderState(authority, pdaIndex)`): each inbound update
 *    invalidates the query so the rich snapshot re-fetches. This keeps equity /
 *    uPNL / margin live without re-implementing the SDK's margin engine on the
 *    raw WS deltas.
 *
 * OWNED BY: Account agent (`src/account/`).
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PhoenixClient, TraderView } from "@ellipsis-labs/rise";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import type { AccountOverview } from "./lib";

/** Default trader PDA index — the primary trader account for an authority. */
const DEFAULT_PDA_INDEX = 0;

function traderStateKey(authority: string | undefined) {
  return ["account", "trader-state", authority ?? "none"] as const;
}

async function fetchTraderView(
  client: PhoenixClient,
  authority: string,
): Promise<TraderView | null> {
  const res = await client.api
    .traders()
    .getTraderState(authority, { pdaIndex: DEFAULT_PDA_INDEX });
  // A freshly-onboarded (or unregistered) authority may report no traders.
  return res.traders.length > 0 ? res.traders[0] : null;
}

/** Ratio helper kept at the display edge (never feeds trading math). */
function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** Project a `TraderView` into the flat overview the Account UI renders. */
export function toAccountOverview(view: TraderView): AccountOverview {
  const equity = view.portfolioValue.value;
  const upnl = view.unrealizedPnl.value;

  // Notional exposure across all positions — basis for account leverage.
  const notional = view.positions.reduce(
    (sum, p) => sum + Math.abs(p.positionValue.value),
    0,
  );

  const marginRatioValue = safeRatio(view.maintenanceMargin.value, equity);
  const leverageValue = safeRatio(notional, equity);

  const upnlSign: -1 | 0 | 1 = upnl > 0 ? 1 : upnl < 0 ? -1 : 0;

  return {
    collateralBalance: view.collateralBalance.ui,
    effectiveCollateral: view.effectiveCollateral.ui,
    portfolioValue: view.portfolioValue.ui,
    unrealizedPnl: view.unrealizedPnl.ui,
    unrealizedPnlSign: upnlSign,
    maintenanceMargin: view.maintenanceMargin.ui,
    initialMargin: view.initialMargin.ui,
    marginRatio:
      marginRatioValue == null
        ? "—"
        : `${(marginRatioValue * 100).toFixed(2)}%`,
    accountLeverage:
      leverageValue == null ? "—" : `${leverageValue.toFixed(2)}x`,
    openPositions: view.positions.length,
    riskState: view.riskState,
  };
}

export interface UseTraderStateResult {
  /** The rich trader snapshot, or `null` if the authority has no trader yet. */
  view: TraderView | null;
  /** Flat overview projection, or `null` until the first snapshot resolves. */
  overview: AccountOverview | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Live trader-state for `authority`. Pass `undefined` (no wallet) to keep the
 * query idle. Returns the rich `TraderView` plus a flat `AccountOverview`.
 */
export function useTraderState(
  authority: string | undefined,
): UseTraderStateResult {
  const client = usePhoenixClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: traderStateKey(authority),
    enabled: !!authority,
    queryFn: () => fetchTraderView(client, authority as string),
    staleTime: 5_000,
    retry: 1,
  });

  // Live updates: re-fetch the rich snapshot whenever the WS reports a change.
  useEffect(() => {
    const streams = client.streams;
    if (!authority || !streams) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        for await (const _update of streams.traderState(
          authority,
          DEFAULT_PDA_INDEX,
          controller.signal,
        )) {
          if (cancelled) break;
          queryClient.invalidateQueries({
            queryKey: traderStateKey(authority),
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
  return {
    view,
    overview: view ? toAccountOverview(view) : null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error) ?? null,
    refetch: () => query.refetch(),
  };
}

/** The trader PDA index the Account feature operates on. */
export { DEFAULT_PDA_INDEX };
