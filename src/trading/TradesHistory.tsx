"use client";

/**
 * TradesHistory — the connected wallet's own Phoenix-perps fill history.
 *
 * Distinct from `market-data/TradesList`, which shows the *public market*
 * fills feed. This shows the *connected user's own* fills: market, direction,
 * size, price, realized PnL, fee and a short relative timestamp — newest
 * first, in a virtualized scrollable list.
 *
 * Data comes from `useTradesHistory`, keyed by the connected wallet's
 * `authority` (from `useWallet()`), polling every 30s.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { cn } from "@/lib/cn";
import { CoinIcon } from "@/components/CoinIcon";
import { useWallet } from "@/wallet/WalletProvider";
import { useTradesHistory, type TradeHistoryRow } from "./useTradesHistory";

const ROW_HEIGHT = 56;
const VISIBLE_ROWS = 8;
const LIST_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT;

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Magnitude-aware price precision. */
function fmtPrice(value: number): string {
  const abs = Math.abs(value);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Compact base-lot size. */
function fmtSize(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

/** Signed USD amount, e.g. `+$12.40` / `-$3.10`. */
function fmtSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Unsigned USD amount, e.g. `$0.12`. */
function fmtUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Short relative timestamp, e.g. `12s`, `4m`, `3h`, `2d`. */
function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface TradesHistoryProps {
  /** Optional market filter — when set, only fills in this market show. */
  symbol?: string;
}

export function TradesHistory({ symbol }: TradesHistoryProps) {
  const { wallet } = useWallet();
  const authority = wallet?.authority ?? null;

  const { data, isLoading, isError, error, refetch } =
    useTradesHistory(authority);

  const rows = useMemo<TradeHistoryRow[]>(() => {
    const all = data ?? [];
    if (!symbol) return all;
    return all.filter(
      (r) => r.marketSymbol.toUpperCase() === symbol.toUpperCase(),
    );
  }, [data, symbol]);

  // No wallet — calm empty state.
  if (!authority) {
    return (
      <EmptyState
        title="Trade history"
        detail="Connect a wallet to see your trade history."
      />
    );
  }

  if (isLoading) return <TradesHistorySkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated p-6 text-center">
        <span className="text-sm font-semibold text-fg">
          Could not load trade history
        </span>
        <p className="max-w-xs text-xs leading-snug text-fg-muted">
          {error instanceof Error
            ? error.message
            : "Something went wrong fetching your fills."}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-1 rounded-md border border-border px-4 py-2 text-xs font-semibold text-fg active:bg-bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No trades yet"
        detail={
          symbol
            ? `You have no fills in ${symbol}.`
            : "Your filled trades will appear here."
        }
      />
    );
  }

  const Row = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    if (!row) return <div style={style} />;
    return (
      <div style={style} className="px-0.5">
        <TradeRow row={row} />
      </div>
    );
  };

  return (
    <div className="overflow-hidden">
      <div className="flex items-center px-3 pb-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">
        <span className="flex-1 text-left">Market</span>
        <span className="flex-1 text-right">Size / Price</span>
        <span className="flex-1 text-right">PnL / Fee</span>
      </div>
      <FixedSizeList
        height={Math.min(LIST_HEIGHT, rows.length * ROW_HEIGHT)}
        width="100%"
        itemCount={rows.length}
        itemSize={ROW_HEIGHT}
        overscanCount={6}
      >
        {Row}
      </FixedSizeList>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function TradeRow({ row }: { row: TradeHistoryRow }) {
  const isBuy = row.side === "buy";
  const pnlSign = row.realizedPnl > 0 ? "up" : row.realizedPnl < 0 ? "down" : "flat";

  return (
    <div className="flex h-[52px] items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3">
      {/* Market + direction */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CoinIcon symbol={row.marketSymbol} size={22} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-semibold text-fg">
            {row.marketSymbol}
          </span>
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wide",
              isBuy ? "text-up" : "text-down",
            )}
          >
            {isBuy ? "Buy" : "Sell"}
          </span>
        </div>
      </div>

      {/* Size / price */}
      <div className="flex flex-1 flex-col items-end">
        <span className="font-mono text-xs tabular-nums text-fg">
          {fmtSize(row.size)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-fg-muted">
          @ {fmtPrice(row.price)}
        </span>
      </div>

      {/* PnL / fee + time */}
      <div className="flex flex-1 flex-col items-end">
        <span
          className={cn(
            "font-mono text-xs font-semibold tabular-nums",
            pnlSign === "up" && "text-up",
            pnlSign === "down" && "text-down",
            pnlSign === "flat" && "text-fg-muted",
          )}
        >
          {fmtSignedUsd(row.realizedPnl)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-fg-subtle">
          {fmtUsd(row.fees)} fee · {fmtRelative(row.timeMs)}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated p-6 text-center">
      <span className="text-sm font-semibold text-fg">{title}</span>
      <p className="max-w-xs text-xs leading-snug text-fg-muted">{detail}</p>
    </div>
  );
}

function TradesHistorySkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-[52px] animate-pulse rounded-lg border border-border bg-bg-elevated"
        />
      ))}
    </div>
  );
}
