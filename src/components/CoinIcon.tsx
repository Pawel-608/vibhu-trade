"use client";

/**
 * CoinIcon — a small circular token icon for a market ticker.
 *
 * The Phoenix perps API exposes no token logo/icon URL for markets or assets
 * (the SDK's `ExchangeMarketConfig` / `MarketView` carry only `symbol` and
 * `assetId`). Icons are resolved in three tiers:
 *   1. the static `COIN_ICON_URLS` map (CoinGecko URLs baked at build time —
 *      no runtime CoinGecko calls, so no rate limits / CORS issues);
 *   2. the `cryptocurrency-icons` jsDelivr CDN, keyed by lowercase ticker;
 *   3. on `<img>` load error, a muted circular monogram.
 * So the icon always degrades gracefully for unknown/exotic markets.
 *
 * Styling/markup only — no app logic.
 */

import { useState } from "react";
import { cn } from "@/lib/cn";
import { COIN_ICON_URLS } from "./coinIcons";

export interface CoinIconProps {
  symbol: string;
  /** Rendered diameter in px. */
  size?: number;
  className?: string;
}

/**
 * Resolve a ticker to its CoinGecko icon URL, or `undefined` when there is no
 * good icon (commodity / exotic markets) — the caller then renders a monogram.
 * The static `COIN_ICON_URLS` map covers every crypto market; the old
 * `cryptocurrency-icons` CDN tier was dropped because it produced broken,
 * blank-looking results for non-crypto tickers.
 */
function iconUrl(symbol: string): string | undefined {
  return COIN_ICON_URLS[symbol.trim().toUpperCase()];
}

/** First 1–2 letters of the ticker, used for the fallback monogram. */
function monogram(symbol: string): string {
  return symbol.trim().slice(0, 2).toUpperCase();
}

export function CoinIcon({ symbol, size = 20, className }: CoinIconProps) {
  const [failed, setFailed] = useState(false);
  const url = iconUrl(symbol);
  const dimensions = { width: size, height: size };

  if (!url || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-bg-muted font-medium leading-none text-fg-muted",
          className,
        )}
        style={{ ...dimensions, fontSize: Math.round(size * 0.42) }}
      >
        {monogram(symbol)}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(
        "inline-block shrink-0 rounded-full bg-bg-muted object-cover",
        className,
      )}
      style={dimensions}
    />
  );
}
