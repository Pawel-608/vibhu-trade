"use client";

/**
 * MarketStatsStrip — a compact block of secondary live stats for the active
 * market (oracle, 24h volume, open interest, funding).
 *
 * Mark price and 24h change live in `MarketHeader`, so they are not repeated
 * here. The four secondary stats are laid out as a tidy 2×2 grid so every
 * label + value stays fully visible on a 390px mobile viewport with no
 * horizontal overflow (Hyperliquid-style — calm and minimal, not a card).
 *
 * Values come from the SDK market-data store (WS `marketStats`) via a leaf
 * selector for the active symbol.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { cn } from "@/lib/cn";
import { useMarketDataRow } from "./useMarkets";
import { fmtPrice, fmtUsdCompact, fmtCompact, fmtFunding } from "./display";

export interface MarketStatsStripProps {
  symbol: string;
}

export function MarketStatsStrip({ symbol }: MarketStatsStripProps) {
  const row = useMarketDataRow(symbol);

  const funding = row?.currentFundingRate ?? null;
  const fundingDir =
    funding == null ? 0 : funding > 0 ? 1 : funding < 0 ? -1 : 0;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-b border-border bg-bg px-4 py-2.5">
      <Stat label="Oracle" value={fmtPrice(row?.oraclePrice ?? null)} />
      <Stat label="24h Vol" value={fmtUsdCompact(row?.dayVolumeUsd ?? null)} />
      <Stat label="OI" value={fmtCompact(row?.openInterest ?? null)} />
      <Stat
        label="Funding"
        value={fmtFunding(funding)}
        className={cn(
          fundingDir > 0 && "text-up",
          fundingDir < 0 && "text-down",
        )}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <span
        className={cn(
          "truncate font-mono text-xs tabular-nums text-fg",
          className,
        )}
      >
        {value}
      </span>
    </div>
  );
}
