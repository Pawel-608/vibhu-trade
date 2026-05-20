/**
 * Trading-feature shared helpers.
 *
 * Conventions
 *  - Symbols are bare tickers ("SOL"), per API-RECON.md.
 *  - On-chain quantities stay in the SDK's integer lot/tick domain. The helpers
 *    here keep USD math in `bigint` micro-USD (6dp) and only render strings at
 *    the display edge — no IEEE-754 floats in the math path (PLAN.md §3).
 *  - Pre-trade summary numbers (order value / margin / liq price) are *estimates*
 *    for the UI; the on-chain margin engine is authoritative.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { Side } from "@ellipsis-labs/rise";
import type { ExchangeMarketSnapshot } from "@ellipsis-labs/rise";
import type { Side as AppSide } from "@/types";

/** 1 USD expressed in micro-USD (the internal fixed-point scale, 6dp). */
export const MICRO_USD = 1_000_000n;

/** Map the app's long/short side to the SDK's Bid/Ask enum. */
export function toSdkSide(side: AppSide): Side {
  return side === "long" ? Side.Bid : Side.Ask;
}

/** Map the SDK `Side` (or wire "bid"/"ask") to the app's long/short. */
export function fromSdkSide(side: Side | "bid" | "ask"): AppSide {
  if (side === Side.Bid || side === "bid") return "long";
  return "short";
}

/** True when a value parses to a finite, non-negative decimal string. */
export function isValidDecimal(value: string): boolean {
  if (value.trim() === "") return false;
  return /^(?:0|[1-9]\d*)?(?:\.\d*)?$/.test(value.trim()) && value.trim() !== ".";
}

/** Parse a decimal string into micro-USD (`bigint`). Returns 0n for blanks. */
export function usdToMicros(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === ".") return 0n;
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = body.split(".");
  const paddedFraction = `${fraction}000000`.slice(0, 6);
  const micros =
    BigInt(whole || "0") * MICRO_USD + BigInt(paddedFraction || "0");
  return negative ? -micros : micros;
}

/** Render a micro-USD `bigint` as a fixed-point string (no grouping). */
export function microsToString(micros: bigint, displayDecimals = 2): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICRO_USD;
  const fraction = (abs % MICRO_USD).toString().padStart(6, "0");
  const shown =
    displayDecimals >= 6
      ? fraction.padEnd(displayDecimals, "0")
      : fraction.slice(0, displayDecimals);
  const sign = negative && abs !== 0n ? "-" : "";
  return shown.length > 0 ? `${sign}${whole}.${shown}` : `${sign}${whole}`;
}

/** Format a micro-USD `bigint` as a `$`-prefixed display string. */
export function formatMicrosUsd(micros: bigint, displayDecimals = 2): string {
  const negative = micros < 0n;
  const body = microsToString(negative ? -micros : micros, displayDecimals);
  return negative ? `-$${body}` : `$${body}`;
}

/** Parse a decimal/number string to micro-USD; tolerant of `null`/`undefined`. */
export function safeUsdToMicros(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return usdToMicros(typeof value === "number" ? value.toString() : value);
}

/**
 * The single largest leverage a market offers (from its first / lowest-size
 * leverage tier). Higher tiers only reduce leverage as size grows.
 */
export function maxLeverageForMarket(market: ExchangeMarketSnapshot): number {
  if (market.leverageTiers.length === 0) return 1;
  return market.leverageTiers.reduce(
    (max, tier) => Math.max(max, tier.maxLeverage),
    1,
  );
}

/** The maintenance margin factor as a ratio (e.g. 0.5 from 50%-of-initial bps). */
export function maintenanceFactor(market: ExchangeMarketSnapshot): number {
  // riskFactors.maintenance is a multiplier on the initial margin (bps-style;
  // live API reports 50.0 meaning 0.5 of initial margin). Normalise to a ratio.
  const raw = market.riskFactors.maintenance;
  return raw > 1 ? raw / 100 : raw;
}

export interface OrderEstimateInput {
  /** Order side. */
  side: AppSide;
  /** Order size in base units (e.g. "1.5" SOL), decimal string. */
  sizeUnits: string;
  /** Reference price in USD (limit price, or mark price for market orders). */
  priceUsd: string;
  /** Selected leverage (integer, >= 1). */
  leverage: number;
  /** The market being traded. */
  market: ExchangeMarketSnapshot;
}

export interface OrderEstimate {
  /** Notional order value in micro-USD. */
  orderValueMicros: bigint;
  /** Estimated margin required to open, in micro-USD. */
  marginRequiredMicros: bigint;
  /** Estimated liquidation price in micro-USD, or `null` when not computable. */
  liquidationPriceMicros: bigint | null;
}

/**
 * Estimate order value, margin required and liquidation price for a *new*
 * isolated position of `sizeUnits` at `priceUsd` with `leverage`.
 *
 * Liquidation estimate (isolated, ignoring funding & fees):
 *   long :  liq = entry * (1 - 1/lev + mmf/lev)
 *   short:  liq = entry * (1 + 1/lev - mmf/lev)
 * where `mmf` is the maintenance fraction of the initial margin. This mirrors
 * the standard isolated-margin formula; the on-chain engine is authoritative.
 */
export function estimateOrder(input: OrderEstimateInput): OrderEstimate {
  const priceMicros = usdToMicros(input.priceUsd);
  const size = input.sizeUnits.trim();
  const leverage = input.leverage >= 1 ? input.leverage : 1;

  if (priceMicros <= 0n || !isValidDecimal(size) || size === "" || size === "0") {
    return {
      orderValueMicros: 0n,
      marginRequiredMicros: 0n,
      liquidationPriceMicros: null,
    };
  }

  // orderValue = size * price. Keep `size` in micro-units to stay integer.
  const sizeMicros = usdToMicros(size); // reuse 6dp fixed-point for base units
  const orderValueMicros = (sizeMicros * priceMicros) / MICRO_USD;
  const marginRequiredMicros = orderValueMicros / BigInt(leverage);

  // Liquidation price — scale the maintenance-adjusted ratio in bps integers.
  const mmf = maintenanceFactor(input.market); // ratio, e.g. 0.5
  const BPS = 10_000n;
  const mmfBps = BigInt(Math.round(mmf * 10_000));
  const levBps = BigInt(leverage) * BPS;
  // moveBps = (1 - mmf) / leverage, expressed in bps of entry price.
  const moveBps = ((BPS - mmfBps) * BPS) / levBps;
  const liquidationPriceMicros =
    input.side === "long"
      ? (priceMicros * (BPS - moveBps)) / BPS
      : (priceMicros * (BPS + moveBps)) / BPS;

  return {
    orderValueMicros,
    marginRequiredMicros,
    liquidationPriceMicros:
      liquidationPriceMicros > 0n ? liquidationPriceMicros : null,
  };
}

/** Clamp a numeric leverage into `[1, max]` (integer). */
export function clampLeverage(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, 1), Math.max(1, Math.floor(max)));
}

/** A short human label for a margin risk tier. */
export function riskTierLabel(tier: string): string {
  switch (tier) {
    case "safe":
      return "Healthy";
    case "atRisk":
      return "At risk";
    case "cancellable":
      return "At risk";
    case "liquidatable":
      return "Liquidatable";
    case "backstopLiquidatable":
      return "Critical";
    case "highRisk":
      return "Critical";
    default:
      return tier;
  }
}

/** Tailwind text-colour class for a margin risk tier. */
export function riskTierColor(tier: string): string {
  switch (tier) {
    case "safe":
      return "text-up";
    case "atRisk":
    case "cancellable":
      return "text-accent";
    default:
      return "text-down";
  }
}
