"use client";

/**
 * MarketHeader — the persistent top bar of the trade screen.
 *
 * Shows the symbol + chevron (tapping opens the full-screen market selector),
 * the live mark price, and the 24h change. Live data comes from the SDK
 * market-data store (WS `allMids` / `markPrice` / `marketStats`) via a leaf
 * selector for the active symbol, so a price tick re-renders only this bar.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { cn } from "@/lib/cn";
import { CoinIcon } from "@/components/CoinIcon";
import { use24hChange, useMarketDataRow } from "./useMarkets";
import { fmtPrice, fmtPercent } from "./display";

export interface MarketHeaderProps {
  symbol: string;
  onOpenSelector: () => void;
}

export function MarketHeader({ symbol, onOpenSelector }: MarketHeaderProps) {
  const row = useMarketDataRow(symbol);

  const mark = row?.markPrice ?? row?.mid ?? null;
  // The SDK's `priceChange24hPercent` (from the `marketStats` WS
  // `prevDayMarkPrice`) is unreliable — it swings wildly for flat markets.
  // We compute a genuine rolling-24h change from hourly candles instead.
  // `change` is a ratio (0.0123 == +1.23%), matching `fmtPercent`.
  const change = use24hChange(symbol);
  const dir = change == null ? 0 : change > 0 ? 1 : change < 0 ? -1 : 0;

  return (
    <header className="flex min-h-[68px] shrink-0 items-center justify-between border-b border-border bg-bg px-4 py-3">
      <button
        type="button"
        onClick={onOpenSelector}
        className="flex items-center gap-2.5 text-xl font-bold text-fg active:opacity-70"
      >
        <CoinIcon symbol={symbol} size={28} />
        <span>{symbol}</span>
        <span aria-hidden className="text-sm text-fg-muted">
          ▾
        </span>
      </button>

      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-xl font-bold tabular-nums leading-none text-fg">
          {fmtPrice(mark)}
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums leading-none",
            dir > 0 && "text-up",
            dir < 0 && "text-down",
            dir === 0 && "text-fg-muted",
          )}
        >
          {fmtPercent(change)}
        </span>
      </div>
    </header>
  );
}
