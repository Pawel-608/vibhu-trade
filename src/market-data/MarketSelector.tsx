"use client";

/**
 * MarketSelector — full-screen market-switcher overlay.
 *
 * Search box, category tabs, and a sortable list of markets with mark price,
 * 24h change, and 24h volume. Static config comes from the markets HTTP
 * endpoint (TanStack Query); live prices come from the SDK market-data store
 * (WS `allMids` / `markPrice` / `marketStats`). The list is virtualized with
 * `react-window`. Tapping a market routes to `tradeRoute(symbol)`.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useMemo, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type {
  ExchangeMarketConfig,
  PhoenixMarketDataRow,
} from "@ellipsis-labs/rise";
import { cn } from "@/lib/cn";
import { CoinIcon } from "@/components/CoinIcon";
import {
  use24hChangeMap,
  useMarketConfigs,
  useMarketDataRow,
  useMarketDataManager,
  useStoreSelector,
} from "./useMarkets";
import { fmtPrice, fmtPercent, fmtUsdCompact } from "./display";

export interface MarketSelectorProps {
  open: boolean;
  currentSymbol: string;
  onSelect: (symbol: string) => void;
  onClose: () => void;
}

type SortKey = "symbol" | "price" | "change" | "volume";
type SortDir = "asc" | "desc";

const ROW_HEIGHT = 56;
const LIST_HEIGHT = 480;

/** A market joined with its live data row. */
interface MarketRow {
  config: ExchangeMarketConfig;
  markPrice: number | null;
  change: number | null;
  volumeUsd: number | null;
}

export function MarketSelector({
  open,
  currentSymbol,
  onSelect,
  onClose,
}: MarketSelectorProps) {
  const { data: configs, isLoading, isError, refetch } = useMarketConfigs();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  }

  // Filter by search. Sorting needs live data, applied in the row collector
  // component below.
  const filteredConfigs = useMemo(() => {
    if (!configs) return [];
    const q = query.trim().toUpperCase();
    if (!q) return configs;
    return configs.filter((m) => m.symbol.toUpperCase().includes(q));
  }, [configs, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-app flex-col bg-bg">
      {/* Header */}
      <div className="flex h-header shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold text-fg">Select market</span>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-fg-muted active:text-fg"
        >
          Close
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-4 pb-3 pt-3">
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets"
          autoComplete="off"
          className="w-full rounded-md border border-border bg-bg-muted px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
        />
      </div>

      {/* Sortable column header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-[10px] uppercase tracking-wide text-fg-subtle">
        <SortHeader
          label="Market"
          active={sortKey === "symbol"}
          dir={sortDir}
          onClick={() => toggleSort("symbol")}
          className="flex-1 text-left"
        />
        <SortHeader
          label="Price"
          active={sortKey === "price"}
          dir={sortDir}
          onClick={() => toggleSort("price")}
          className="w-24 text-right"
        />
        <SortHeader
          label="24h"
          active={sortKey === "change"}
          dir={sortDir}
          onClick={() => toggleSort("change")}
          className="w-16 text-right"
        />
        <SortHeader
          label="Vol"
          active={sortKey === "volume"}
          dir={sortDir}
          onClick={() => toggleSort("volume")}
          className="w-16 text-right"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <SelectorSkeleton />
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-sm text-fg-muted">
              Could not load markets.
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border border-border px-4 py-2 text-sm text-fg active:bg-bg-muted"
            >
              Retry
            </button>
          </div>
        ) : filteredConfigs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
            No markets match “{query}”.
          </div>
        ) : (
          <MarketList
            configs={filteredConfigs}
            currentSymbol={currentSymbol}
            sortKey={sortKey}
            sortDir={sortDir}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-0.5",
        className,
        className?.includes("text-right") && "justify-end",
        active ? "text-fg" : "active:text-fg-muted",
      )}
    >
      <span>{label}</span>
      {active ? <span>{dir === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}

/**
 * MarketList — collects live data per symbol, sorts, and virtualizes.
 *
 * `useMarketDataRow` must be called per symbol; we do that via small
 * `LiveCell` leaf components inside each row, but sorting needs the values up
 * front. The SDK market-data store updates the same snapshot object, so we
 * read it once per render through a hidden collector that subscribes to the
 * whole store. To keep it simple and correct, each row subscribes to its own
 * symbol; sorting by a live key falls back to a snapshot taken at render.
 */
function MarketList({
  configs,
  currentSymbol,
  sortKey,
  sortDir,
  onSelect,
}: {
  configs: ExchangeMarketConfig[];
  currentSymbol: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSelect: (symbol: string) => void;
}) {
  // Correct rolling-24h change per symbol, computed from hourly candles. The
  // SDK's `priceChange24hPercent` is unreliable, so we never read it here —
  // both the change column and the change-sort use this candle-derived map.
  const symbols = useMemo(() => configs.map((c) => c.symbol), [configs]);
  const changeMap = use24hChangeMap(symbols);

  // For symbol-sort we can sort statically; for live keys we sort by the live
  // snapshot captured through a store read on each render.
  const sorted = useSortedMarkets(configs, sortKey, sortDir, changeMap);

  const Row = ({ index, style }: ListChildComponentProps) => {
    const config = sorted[index];
    return (
      <div style={style}>
        <MarketRowItem
          config={config}
          isCurrent={config.symbol === currentSymbol}
          change={changeMap.get(config.symbol) ?? null}
          onSelect={onSelect}
        />
      </div>
    );
  };

  return (
    <FixedSizeList
      height={LIST_HEIGHT}
      width="100%"
      itemCount={sorted.length}
      itemSize={ROW_HEIGHT}
      overscanCount={6}
    >
      {Row}
    </FixedSizeList>
  );
}

/**
 * Sort markets. Symbol sort is purely static. Live-key sorts subscribe to the
 * whole market-data store snapshot so the list re-orders as data arrives.
 */
function useSortedMarkets(
  configs: ExchangeMarketConfig[],
  sortKey: SortKey,
  sortDir: SortDir,
  changeMap: ReadonlyMap<string, number | null>,
): ExchangeMarketConfig[] {
  // We need a live snapshot keyed by symbol for price/volume sorts. Change is
  // candle-derived (the SDK's `priceChange24hPercent` is unreliable) and comes
  // in via `changeMap`.
  const snapshot = useLiveSnapshotMap(sortKey === "price" || sortKey === "volume");

  return useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const value = (c: ExchangeMarketConfig): number | string => {
      const row = snapshot.get(c.symbol);
      switch (sortKey) {
        case "symbol":
          return c.symbol;
        case "price":
          return row?.markPrice ?? row?.mid ?? -Infinity;
        case "change":
          return changeMap.get(c.symbol) ?? -Infinity;
        case "volume":
          return row?.dayVolumeUsd ?? -Infinity;
      }
    };
    return [...configs].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * factor;
      }
      return ((va as number) - (vb as number)) * factor;
    });
  }, [configs, sortKey, sortDir, snapshot, changeMap]);
}

/**
 * Subscribe to the whole market-data store and project a `symbol -> row` Map.
 * Only used while a live-key sort is active.
 */
function useLiveSnapshotMap(
  enabled: boolean,
): ReadonlyMap<string, PhoenixMarketDataRow> {
  const manager = useMarketDataManager();
  const selector = useMemo(
    () => (state: { marketsBySymbol: Readonly<Record<string, PhoenixMarketDataRow>> }) =>
      enabled ? state.marketsBySymbol : EMPTY_RECORD,
    [enabled],
  );
  const record = useStoreSelector(manager.store, selector);
  return useMemo(() => new Map(Object.entries(record)), [record]);
}

const EMPTY_RECORD: Readonly<Record<string, PhoenixMarketDataRow>> = {};

/** One market row — live cells subscribe per-symbol via leaf selectors. */
function MarketRowItem({
  config,
  isCurrent,
  change,
  onSelect,
}: {
  config: ExchangeMarketConfig;
  isCurrent: boolean;
  /** Candle-derived rolling-24h change ratio (0.0123 == +1.23%). */
  change: number | null;
  onSelect: (symbol: string) => void;
}) {
  const row = useMarketDataRow(config.symbol);
  const mark = row?.markPrice ?? row?.mid ?? null;
  const dir = change == null ? 0 : change > 0 ? 1 : change < 0 ? -1 : 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(config.symbol)}
      className={cn(
        "flex h-14 w-full items-center gap-2 border-b border-border/60 px-4 text-left active:bg-bg-muted",
        isCurrent && "bg-bg-elevated",
      )}
    >
      <CoinIcon symbol={config.symbol} size={28} />
      <span className="flex-1 text-sm font-semibold text-fg">
        {config.symbol}
      </span>
      <span className="w-24 text-right font-mono text-sm tabular-nums text-fg">
        {fmtPrice(mark)}
      </span>
      <span
        className={cn(
          "w-16 text-right font-mono text-xs tabular-nums",
          dir > 0 && "text-up",
          dir < 0 && "text-down",
          dir === 0 && "text-fg-muted",
        )}
      >
        {fmtPercent(change)}
      </span>
      <span className="w-16 text-right font-mono text-xs tabular-nums text-fg-muted">
        {fmtUsdCompact(row?.dayVolumeUsd ?? null)}
      </span>
    </button>
  );
}

function SelectorSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-2 border-b border-border/60 px-4"
        >
          <div className="flex-1">
            <div className="h-3 w-20 rounded bg-bg-muted" />
          </div>
          <div className="h-3 w-16 rounded bg-bg-muted" />
          <div className="h-3 w-10 rounded bg-bg-muted" />
        </div>
      ))}
    </div>
  );
}
