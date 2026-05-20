/**
 * Account-feature shared helpers.
 *
 * Float-free amount conversion between the UI decimal string the user types
 * and the SDK's `bigint` token domain (PLAN.md §3 "No floats"). Collateral on
 * Phoenix perps is canonical USDC — 6 decimals (see API-RECON.md §3, the
 * `usdcMint` in the exchange snapshot).
 *
 * OWNED BY: Account agent (`src/account/`).
 */

/** Decimals of the collateral token (canonical USDC). */
export const COLLATERAL_DECIMALS = 6;

/**
 * Parse a user-entered decimal string (e.g. "12.5") into the SDK's unscaled
 * `bigint` domain. Pure integer arithmetic — never touches IEEE-754.
 *
 * Returns `null` for empty / malformed / zero / negative input.
 */
export function parseAmountToBigint(
  input: string,
  decimals: number = COLLATERAL_DECIMALS,
): bigint | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Allow only digits and a single decimal point.
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const [intPart = "", fracPartRaw = ""] = trimmed.split(".");
  if (intPart === "" && fracPartRaw === "") return null;
  // Reject more fraction digits than the token can represent.
  if (fracPartRaw.length > decimals) return null;

  const fracPart = fracPartRaw.padEnd(decimals, "0");
  const combined = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, "");
  let raw: bigint;
  try {
    raw = BigInt(combined === "" ? "0" : combined);
  } catch {
    return null;
  }
  return raw > 0n ? raw : null;
}

/** True when `input` is a syntactically valid (possibly partial) amount entry. */
export function isAmountInputValid(input: string): boolean {
  return /^\d*\.?\d*$/.test(input.trim());
}

/**
 * Format an unscaled `bigint` token amount into a decimal display string —
 * the inverse of `parseAmountToBigint`. Pure integer arithmetic; trailing
 * fraction zeros are trimmed (an integer amount renders with no point).
 */
export function formatTokenAmount(
  raw: bigint,
  decimals: number = COLLATERAL_DECIMALS,
): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = (abs / base).toString();
  const frac = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const body = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  return negative ? `-${body}` : body;
}

/**
 * The trader's perps overview, derived from a `TraderView` snapshot. All
 * monetary fields are kept as `TokenAmount` (the SDK's `{ value, decimals, ui }`
 * shape) so the display edge can format without floats.
 */
export interface AccountOverview {
  /** Free collateral balance. */
  collateralBalance: string;
  /** Effective collateral (collateral +/- discounted uPNL). */
  effectiveCollateral: string;
  /** Total portfolio value (account equity). */
  portfolioValue: string;
  /** Unrealized PNL across all positions. */
  unrealizedPnl: string;
  /** Sign of unrealized PNL: -1 / 0 / +1 — drives up/down colouring. */
  unrealizedPnlSign: -1 | 0 | 1;
  /** Maintenance margin requirement. */
  maintenanceMargin: string;
  /** Initial margin requirement. */
  initialMargin: string;
  /** Margin ratio as a display string (maintenance / equity), or "—". */
  marginRatio: string;
  /** Account leverage as a display string (notional / equity), or "—". */
  accountLeverage: string;
  /** Number of open positions. */
  openPositions: number;
  /** Coarse risk state for the health badge. */
  riskState: string;
}
