"use client";

/**
 * OrderBook — live L2 orderbook.
 *
 * Backed by the SDK orderbook manager (`client.orderbooks()`), which is
 * pre-wired with the HTTP orderbook snapshot endpoint plus the WS `l2Book`
 * stream. We retain a per-symbol resource and subscribe to its zustand store
 * via a leaf selector. The manager already coalesces snapshot + deltas; we
 * read `bids`/`asks`/`spread` and render a cumulative-depth ladder.
 *
 * Rows are virtualized with `react-window`. Bids are green, asks red, with a
 * cumulative-depth background bar behind each level.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useEffect, useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type {
  PhoenixOrderbookLevel,
  PhoenixOrderbookStoreState,
} from "@ellipsis-labs/rise";
import { cn } from "@/lib/cn";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useStoreSelector } from "./useMarkets";
import { fmtPrice, fmtSize, fmtPercent } from "./display";

export interface OrderBookProps {
  symbol: string;
  onPriceTap?: (price: string) => void;
}

/** How many levels per side to display. */
const DEPTH = 14;
const ROW_HEIGHT = 22;

/** A ladder row with running cumulative size. */
interface LadderRow {
  price: number;
  size: number;
  cumulative: number;
}

/** Pre-compute cumulative depth for one side (already price-sorted by SDK). */
function buildLadder(
  levels: readonly PhoenixOrderbookLevel[],
  count: number,
): LadderRow[] {
  const sliced = levels.slice(0, count);
  let running = 0;
  return sliced.map((l) => {
    running += l.size;
    return { price: l.price, size: l.size, cumulative: running };
  });
}

export function OrderBook({ symbol, onPriceTap }: OrderBookProps) {
  const client = usePhoenixClient();

  // Retain a per-symbol orderbook resource — HTTP snapshot + WS l2Book.
  const resource = useMemo(
    () => client.orderbooks().resource(symbol),
    [client, symbol],
  );
  useEffect(() => {
    const release = resource.retain();
    return release;
    // `resource` is stable per (client, symbol).
  }, [resource]);

  // Leaf selector — re-renders only when this book changes.
  const selector = useMemo(
    () => (state: PhoenixOrderbookStoreState) => ({
      bids: state.bids,
      asks: state.asks,
      spread: state.spread,
      mid: state.mid,
      status: state.status,
    }),
    [],
  );
  const view = useStoreSelector(resource.store, selector);

  const bids = useMemo(() => buildLadder(view.bids, DEPTH), [view.bids]);
  // Asks come ascending; show best (lowest) ask closest to the spread, so
  // render top-down as descending price.
  const asks = useMemo(() => {
    const ladder = buildLadder(view.asks, DEPTH);
    return [...ladder].reverse();
  }, [view.asks]);

  const maxBidCum = bids.length ? bids[bids.length - 1].cumulative : 0;
  const maxAskCum = asks.length ? asks[0].cumulative : 0;
  const maxCum = Math.max(maxBidCum, maxAskCum, 1);

  const loading =
    view.status.isLoading && bids.length === 0 && asks.length === 0;
  const errored = view.status.error != null && bids.length === 0;

  const spreadPct =
    view.spread != null && view.mid != null && view.mid > 0
      ? view.spread / view.mid
      : null;

  if (loading) return <OrderBookSkeleton />;
  if (errored) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-xs text-fg-muted">
        <span>Could not load order book.</span>
        <button
          type="button"
          onClick={() => resource.refresh()}
          className="rounded-md border border-border px-3 py-1 text-fg active:bg-bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      {/* Column header */}
      <div className="flex items-center px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">
        <span className="flex-1 text-left">Price</span>
        <span className="flex-1 text-right">Size</span>
        <span className="flex-1 text-right">Total</span>
      </div>

      {/* Asks (descending price, best ask at bottom) */}
      <BookSide
        rows={asks}
        side="ask"
        maxCum={maxCum}
        onPriceTap={onPriceTap}
      />

      {/* Spread row */}
      <div className="flex items-center justify-between border-y border-border px-3 py-2">
        <span className="font-mono text-sm font-semibold tabular-nums text-fg">
          {fmtPrice(view.mid)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
          Spread {spreadPct != null ? fmtPercent(spreadPct).replace("+", "") : "—"}
        </span>
      </div>

      {/* Bids (descending price, best bid at top) */}
      <BookSide
        rows={bids}
        side="bid"
        maxCum={maxCum}
        onPriceTap={onPriceTap}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */

function BookSide({
  rows,
  side,
  maxCum,
  onPriceTap,
}: {
  rows: LadderRow[];
  side: "bid" | "ask";
  maxCum: number;
  onPriceTap?: (price: string) => void;
}) {
  const Row = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    if (!row) return <div style={style} />;
    const depthPct = Math.min(100, (row.cumulative / maxCum) * 100);
    return (
      <div style={style}>
        <button
          type="button"
          onClick={() => onPriceTap?.(String(row.price))}
          className="relative flex h-[22px] w-full items-center px-3 text-[11px] active:opacity-70"
        >
          {/* Cumulative-depth background bar */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 right-0",
              side === "bid" ? "bg-up/10" : "bg-down/10",
            )}
            style={{ width: `${depthPct}%` }}
          />
          <span
            className={cn(
              "relative flex-1 text-left font-mono tabular-nums",
              side === "bid" ? "text-up" : "text-down",
            )}
          >
            {fmtPrice(row.price)}
          </span>
          <span className="relative flex-1 text-right font-mono tabular-nums text-fg">
            {fmtSize(row.size)}
          </span>
          <span className="relative flex-1 text-right font-mono tabular-nums text-fg-muted">
            {fmtSize(row.cumulative)}
          </span>
        </button>
      </div>
    );
  };

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-fg-subtle"
        style={{ height: DEPTH * ROW_HEIGHT }}
      >
        No {side === "bid" ? "bids" : "asks"}
      </div>
    );
  }

  return (
    <FixedSizeList
      height={DEPTH * ROW_HEIGHT}
      width="100%"
      itemCount={rows.length}
      itemSize={ROW_HEIGHT}
      overscanCount={4}
    >
      {Row}
    </FixedSizeList>
  );
}

function OrderBookSkeleton() {
  return (
    <div className="overflow-hidden p-3">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i} className="flex h-[22px] items-center gap-2">
          <div className="h-2.5 flex-1 rounded bg-bg-muted/60" />
          <div className="h-2.5 flex-1 rounded bg-bg-muted/40" />
          <div className="h-2.5 flex-1 rounded bg-bg-muted/30" />
        </div>
      ))}
    </div>
  );
}
