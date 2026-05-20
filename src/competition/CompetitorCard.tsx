"use client";

/**
 * CompetitorCard — one trader's panel in the Vibhu vs Drew challenge.
 *
 * Shows account value (hero), net realized PnL, trade count, fees, current
 * open-position status, return vs the assumed baseline, and a compact
 * top-markets PnL breakdown.
 *
 * OWNED BY: Competition feature (`src/competition/`).
 */

import Link from "next/link";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/format";
import {
  CHALLENGE_START_USD,
  type CompetitorStats,
  type OpenPosition,
} from "./useChallengeData";

/** How many market rows the breakdown shows before collapsing the rest. */
const MAX_MARKET_ROWS = 4;

export interface CompetitorCardProps {
  competitor: CompetitorStats;
  /** Whether this competitor currently leads the challenge. */
  isLeader: boolean;
}

/** Format a USD figure with sign + thousands separators. */
function fmtUsd(value: number, opts?: { sign?: boolean }): string {
  const sign = opts?.sign && value > 0 ? "+" : value < 0 ? "-" : "";
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

/** Format a ratio as a signed percentage, e.g. -36.66%. */
function fmtPct(ratio: number): string {
  const sign = ratio > 0 ? "+" : "";
  return `${sign}${(ratio * 100).toFixed(2)}%`;
}

/** Tailwind text colour for a signed value (green up / red down / neutral). */
function pnlColor(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-fg";
}

export function CompetitorCard({ competitor, isLeader }: CompetitorCardProps) {
  const {
    id,
    name,
    authority,
    accountValue,
    netRealizedPnL,
    tradeCount,
    grossRealizedPnL,
    totalFees,
    positions,
    returnRatio,
    markets,
  } = competitor;

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-bg-elevated p-4",
        isLeader ? "border-accent/50" : "border-border",
      )}
    >
      {/* Identity row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-fg">{name}</h3>
          {isLeader && (
            <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              Leading
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-fg-subtle">
          {shortenAddress(authority)}
        </span>
      </div>

      {/* Hero: account value */}
      <div>
        <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          Account Value
        </span>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums text-fg">
            {fmtUsd(accountValue)}
          </span>
          <span
            className={cn(
              "font-mono text-xs font-medium tabular-nums",
              pnlColor(returnRatio),
            )}
          >
            {fmtPct(returnRatio)}
          </span>
        </div>
        <span className="text-[10px] text-fg-subtle">
          vs assumed ${CHALLENGE_START_USD.toLocaleString("en-US")} baseline
        </span>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-border pt-3">
        <Stat
          label="Net PnL"
          value={fmtUsd(netRealizedPnL, { sign: true })}
          valueClassName={pnlColor(netRealizedPnL)}
        />
        <Stat label="Trades" value={String(tradeCount)} />
        <Stat label="Fees" value={fmtUsd(totalFees)} />
      </div>

      {/* Reverse Vibhu Index — only on Vibhu's card */}
      {id === "vibhu" && (
        <ReverseVibhuLink
          grossRealizedPnL={grossRealizedPnL}
          totalFees={totalFees}
        />
      )}

      {/* Current status */}
      <PositionStatus positions={positions} />

      {/* Top-markets PnL breakdown */}
      {markets.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
            Top Markets — Realized PnL
          </span>
          <div className="flex flex-col gap-1">
            {markets.slice(0, MAX_MARKET_ROWS).map((m) => (
              <div
                key={m.marketSymbol}
                className="flex items-center justify-between text-xs"
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="font-medium text-fg">{m.marketSymbol}</span>
                  <span className="text-[10px] text-fg-subtle">
                    {m.count} {m.count === 1 ? "trade" : "trades"}
                  </span>
                </span>
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    pnlColor(m.realizedPnL),
                  )}
                >
                  {fmtUsd(m.realizedPnL, { sign: true })}
                </span>
              </div>
            ))}
            {markets.length > MAX_MARKET_ROWS && (
              <span className="text-[10px] text-fg-subtle">
                +{markets.length - MAX_MARKET_ROWS} more market
                {markets.length - MAX_MARKET_ROWS === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums text-fg",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Reverse Vibhu Index teaser — only rendered on Vibhu's card.
 *
 * Shows the hypothetical index value for a strategy that fades every one of
 * Vibhu's trades: `CHALLENGE_START_USD + (−grossRealizedPnL − totalFees)`.
 * Tapping it opens the full breakdown at `/competition/reverse-vibhu`.
 */
function ReverseVibhuLink({
  grossRealizedPnL,
  totalFees,
}: {
  grossRealizedPnL: number;
  totalFees: number;
}) {
  // Fade his side: realized PnL flips sign, fees are still paid.
  const net = -grossRealizedPnL - totalFees;
  const index = CHALLENGE_START_USD + net;

  return (
    <Link
      href="/competition/reverse-vibhu"
      className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-bg px-3 py-2.5 active:bg-accent/20"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-accent">
          Reverse Vibhu Index
        </span>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums text-fg">
            {fmtUsd(index)}
          </span>
          <span
            className={cn(
              "font-mono text-xs font-semibold tabular-nums",
              pnlColor(net),
            )}
          >
            {fmtUsd(net, { sign: true })}
          </span>
        </div>
        <span className="text-[10px] text-fg-muted">
          Fade every one of his trades
        </span>
      </div>
      <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-accent">
        View breakdown →
      </span>
    </Link>
  );
}

/**
 * Current open-position status. Both wallets are typically flat; when a
 * position is present, render whatever recognizable fields exist defensively.
 */
function PositionStatus({ positions }: { positions: OpenPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-bg-muted px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-fg-subtle" />
        <span className="text-xs text-fg-muted">Flat — no open positions</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-bg-muted px-3 py-2">
      <span className="text-xs font-medium text-fg">
        {positions.length} open position{positions.length === 1 ? "" : "s"}
      </span>
      {positions.map((p, i) => (
        <PositionRow key={i} position={p} />
      ))}
    </div>
  );
}

/** Pick a string-ish field from a raw position object by candidate keys. */
function pickField(
  raw: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = raw[key];
    if (v == null) continue;
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "object" && "ui" in (v as object)) {
      const ui = (v as { ui?: unknown }).ui;
      if (typeof ui === "string") return ui;
    }
  }
  return undefined;
}

/** A single open position rendered from whatever fields are present. */
function PositionRow({ position }: { position: OpenPosition }) {
  const raw = position.raw;
  const symbol = pickField(raw, ["marketSymbol", "symbol", "market"]);
  const size = pickField(raw, ["size", "baseLots", "lots", "baseSize"]);
  const direction = pickField(raw, ["direction", "side"]);
  const upnl = position.subaccountUnrealizedPnlUi;
  const upnlNum = upnl != null ? parseFloat(upnl) : NaN;

  const parts = [direction, size, symbol].filter(Boolean);
  const label = parts.length > 0 ? parts.join(" ") : "Position";

  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="font-mono text-fg-muted">{label}</span>
      {Number.isFinite(upnlNum) && (
        <span
          className={cn(
            "font-mono tabular-nums",
            pnlColor(upnlNum),
          )}
        >
          {upnlNum > 0 ? "+" : ""}
          {upnlNum.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      )}
    </div>
  );
}
