/**
 * Display-edge formatting helpers.
 *
 * IMPORTANT (PLAN.md §3 "No floats"): all on-chain math is done in the Rise
 * SDK's `bigint` lots/ticks domain. These helpers ONLY format values for
 * display — they never feed back into trading math. To stay precise they
 * operate on `bigint` + an explicit `decimals` scale and do integer division
 * by hand rather than going through IEEE-754 floats.
 *
 * SAFE for any feature agent to import. Do not edit unless you own shared lib.
 */

/** A value expressed as an unscaled integer plus its decimal scale. */
export interface ScaledAmount {
  /** Raw integer amount (e.g. lamports, lots, ticks * scale). */
  raw: bigint;
  /** Number of decimal places `raw` is scaled by. */
  decimals: number;
}

/**
 * Format a scaled bigint amount as a fixed-point decimal string.
 * Pure integer arithmetic — no float conversion.
 *
 * @param raw          unscaled integer value
 * @param decimals     scale of `raw`
 * @param displayDecimals  how many fraction digits to show (default: `decimals`)
 */
export function formatScaled(
  raw: bigint,
  decimals: number,
  displayDecimals?: number,
): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const intPart = abs / scale;
  const fracPart = abs % scale;

  let fracStr = decimals > 0 ? fracPart.toString().padStart(decimals, "0") : "";
  const show = displayDecimals ?? decimals;
  if (show < fracStr.length) {
    // Truncate (no rounding) — display only.
    fracStr = fracStr.slice(0, show);
  } else if (show > fracStr.length) {
    fracStr = fracStr.padEnd(show, "0");
  }

  const sign = negative && (intPart !== 0n || fracPart !== 0n) ? "-" : "";
  const grouped = groupThousands(intPart.toString());
  return fracStr.length > 0 ? `${sign}${grouped}.${fracStr}` : `${sign}${grouped}`;
}

/** Convenience overload that accepts a {@link ScaledAmount}. */
export function formatAmount(
  amount: ScaledAmount,
  displayDecimals?: number,
): string {
  return formatScaled(amount.raw, amount.decimals, displayDecimals);
}

/**
 * Format a price for display. Phoenix prices arrive scaled; pass the raw
 * integer and its tick/price decimals.
 */
export function formatPrice(
  raw: bigint,
  decimals: number,
  displayDecimals = 2,
): string {
  return formatScaled(raw, decimals, displayDecimals);
}

/** Format an order/position size (base units). */
export function formatSize(
  raw: bigint,
  decimals: number,
  displayDecimals = 4,
): string {
  return formatScaled(raw, decimals, displayDecimals);
}

/** Format a USD value with a leading `$`. */
export function formatUsd(
  raw: bigint,
  decimals: number,
  displayDecimals = 2,
): string {
  const negative = raw < 0n;
  const body = formatScaled(negative ? -raw : raw, decimals, displayDecimals);
  return negative ? `-$${body}` : `$${body}`;
}

/**
 * Format a percentage. `bps` is integer basis points (1% = 100 bps), which is
 * how funding rates / changes are typically transported — keeps it float-free.
 */
export function formatPercentFromBps(bps: number, displayDecimals = 2): string {
  const sign = bps > 0 ? "+" : "";
  const pct = bps / 100;
  return `${sign}${pct.toFixed(displayDecimals)}%`;
}

/**
 * Format an already-computed ratio (e.g. 0.0123 -> "1.23%"). Use only for
 * values that originate as display ratios, never for trading math.
 */
export function formatPercent(ratio: number, displayDecimals = 2): string {
  const sign = ratio > 0 ? "+" : "";
  return `${sign}${(ratio * 100).toFixed(displayDecimals)}%`;
}

/** Compact a large number for stat rows (e.g. 1_234_567 -> "1.23M"). */
export function formatCompact(value: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Truncate a Solana pubkey for display (e.g. "7xKX…9aBc"). */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** Insert thousands separators into an integer string. */
function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
