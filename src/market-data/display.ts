/**
 * display — number formatting for live market-data UI.
 *
 * The Phoenix HTTP/WS market-data surface (orderbook tuples, candles, mids,
 * mark price, market stats) transports prices/sizes as plain JSON numbers,
 * NOT scaled bigints — see API-RECON.md §3. These are *display* values for
 * read-only market data; they never feed order math, which stays in the SDK's
 * bigint lots/ticks domain (handled by the Trading agent).
 *
 * `@/lib/format` is bigint-first; these helpers wrap `Intl.NumberFormat` for
 * the float values this feature actually receives. Kept inside the feature
 * directory so the shared lib stays bigint-only.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

/** Pick a sensible price precision from the value's magnitude. */
export function priceDecimals(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 3;
  if (abs >= 0.01) return 5;
  return 8;
}

/** Format a price for display with magnitude-aware precision. */
export function fmtPrice(value: number | null | undefined, decimals?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const d = decimals ?? priceDecimals(value);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Format a base-asset size. */
export function fmtSize(value: number | null | undefined, decimals = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a USD amount with a `$` prefix. */
export function fmtUsd(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const neg = value < 0;
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return neg ? `-$${body}` : `$${body}`;
}

/** Compact a large number (e.g. 1_234_567 -> "1.23M"). */
export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact USD (e.g. "$1.23M"). */
export function fmtUsdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const neg = value < 0;
  const body = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return neg ? `-$${body}` : `$${body}`;
}

/**
 * Format a signed percentage from a ratio (e.g. 0.0123 -> "+1.23%").
 * Used for 24h change.
 */
export function fmtPercent(
  ratio: number | null | undefined,
  decimals = 2,
): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/**
 * Format a funding-rate ratio with sign (e.g. 0.000418 -> "+0.0418%").
 * Funding rates are small — use higher precision.
 */
export function fmtFunding(
  ratio: number | null | undefined,
  decimals = 4,
): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Format an ms-epoch timestamp as HH:MM:SS (local time). */
export function fmtClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Coerce a value that may be a numeric string / ISO string into ms epoch. */
export function toEpochMs(value: number | string | bigint): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") {
    // Heuristic: seconds vs milliseconds.
    return value < 1e12 ? value * 1000 : value;
  }
  const asNum = Number(value);
  if (Number.isFinite(asNum)) {
    return asNum < 1e12 ? asNum * 1000 : asNum;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Parse a possibly-string numeric field into a number. */
export function toNum(value: number | string | null | undefined): number {
  if (value == null) return NaN;
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}
