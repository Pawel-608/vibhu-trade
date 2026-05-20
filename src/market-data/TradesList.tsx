"use client";

/**
 * TradesList — recent market trades (fills) feed.
 *
 * Seeds from the HTTP market-fills endpoint
 * (`client.api.trades().getMarketFills`) wrapped in TanStack Query, then
 * stays live via the WS `fills` stream (`client.streams.fills(symbol)`).
 * Inbound fills are rAF-batched into a bounded newest-first ring buffer by
 * `useStreamBuffer`, and the list is virtualized with `react-window`.
 *
 * Side: Phoenix market fills carry a signed `quoteQty`. A negative `quoteQty`
 * means the taker paid quote to receive base — a buy; positive means a sell.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type {
  MarketFillsResponse,
  MarketFillRecord,
  FillUpdate,
} from "@ellipsis-labs/rise";
import { cn } from "@/lib/cn";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useStreamBuffer } from "./useStream";
import { fmtPrice, fmtSize, fmtClock, toEpochMs, toNum } from "./display";

export interface TradesListProps {
  symbol: string;
}

const ROW_HEIGHT = 26;
const LIST_HEIGHT = 14 * ROW_HEIGHT;
const CAPACITY = 100;
const SEED_LIMIT = 50;

/** Normalized trade row for rendering. */
interface TradeRow {
  id: string;
  price: number;
  size: number;
  /** "buy" (taker bought base) or "sell". */
  side: "buy" | "sell";
  timeMs: number;
}

/** A negative signed quote quantity means the taker bought base. */
function inferSide(quoteQty: string): "buy" | "sell" {
  return toNum(quoteQty) < 0 ? "buy" : "sell";
}

function fromHttpFill(f: MarketFillRecord, idx: number): TradeRow {
  return {
    id: `${f.transactionSignature}:${idx}`,
    price: toNum(f.price),
    size: Math.abs(toNum(f.baseQty)),
    side: inferSide(f.quoteQty),
    timeMs: toEpochMs(f.timestamp),
  };
}

function fromWsFill(u: FillUpdate): TradeRow {
  const f = u.fill;
  return {
    id: `${f.transactionSignature}:${f.timestampMs}`,
    price: toNum(f.price),
    size: Math.abs(toNum(f.baseQty)),
    side: inferSide(f.quoteQty),
    timeMs: f.timestampMs ?? toEpochMs(f.timestamp),
  };
}

export function TradesList({ symbol }: TradesListProps) {
  const client = usePhoenixClient();

  // Initial page — one-shot HTTP read.
  const {
    data: seed,
    isLoading,
    isError,
    refetch,
  } = useQuery<MarketFillsResponse>({
    queryKey: ["market-fills", symbol],
    queryFn: () =>
      client.api.trades().getMarketFills(symbol, { limit: SEED_LIMIT }),
    staleTime: 10_000,
    enabled: symbol.length > 0,
  });

  const seedRows = useMemo<TradeRow[]>(
    () => (seed?.data ?? []).map(fromHttpFill),
    [seed],
  );

  // Live fills — rAF-batched into a bounded buffer.
  const liveRows = useStreamBuffer<FillUpdate, TradeRow>(
    client.streams
      ? (signal) => client.streams!.fills(symbol, signal)
      : null,
    (u) => [fromWsFill(u)],
    CAPACITY,
    [client, symbol],
  );

  // Live buffer first (newest), then seed; de-dupe by id; cap length.
  const rows = useMemo<TradeRow[]>(() => {
    const seen = new Set<string>();
    const merged: TradeRow[] = [];
    for (const r of [...liveRows, ...seedRows]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
      if (merged.length >= CAPACITY) break;
    }
    return merged;
  }, [liveRows, seedRows]);

  if (isLoading && rows.length === 0) return <TradesSkeleton />;
  if (isError && rows.length === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-xs text-fg-muted">
        <span>Could not load trades.</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-md border border-border px-3 py-1 text-fg active:bg-bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  const Row = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    if (!row) return <div style={style} />;
    return (
      <div style={style}>
        <div className="flex h-[26px] items-center px-3 text-[11px]">
          <span
            className={cn(
              "flex-1 text-left font-mono tabular-nums",
              row.side === "buy" ? "text-up" : "text-down",
            )}
          >
            {fmtPrice(row.price)}
          </span>
          <span className="flex-1 text-right font-mono tabular-nums text-fg">
            {fmtSize(row.size)}
          </span>
          <span className="flex-1 text-right font-mono tabular-nums text-fg-subtle">
            {fmtClock(row.timeMs)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-hidden">
      <div className="flex items-center px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">
        <span className="flex-1 text-left">Price</span>
        <span className="flex-1 text-right">Size</span>
        <span className="flex-1 text-right">Time</span>
      </div>
      {rows.length === 0 ? (
        <div
          className="flex items-center justify-center text-[11px] text-fg-subtle"
          style={{ height: LIST_HEIGHT }}
        >
          No recent trades.
        </div>
      ) : (
        <FixedSizeList
          height={LIST_HEIGHT}
          width="100%"
          itemCount={rows.length}
          itemSize={ROW_HEIGHT}
          overscanCount={6}
        >
          {Row}
        </FixedSizeList>
      )}
    </div>
  );
}

function TradesSkeleton() {
  return (
    <div className="overflow-hidden p-3">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="flex h-[26px] items-center gap-2">
          <div className="h-2.5 flex-1 rounded bg-bg-muted/60" />
          <div className="h-2.5 flex-1 rounded bg-bg-muted/40" />
          <div className="h-2.5 flex-1 rounded bg-bg-muted/30" />
        </div>
      ))}
    </div>
  );
}
