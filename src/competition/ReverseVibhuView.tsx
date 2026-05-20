"use client";

/**
 * ReverseVibhuView — the "Reverse Vibhu Index" breakdown page.
 *
 * Visualizes a hypothetical strategy that takes the EXACT OPPOSITE side of
 * every one of Vibhu's fills (see `useReverseVibhu`). Renders a summary, a
 * cumulative sparkline, a per-trade table with a running index, and a
 * per-market reverted breakdown.
 *
 * Standalone, public view — no wallet/login needed. Data is live via
 * `useReverseVibhu` (20s auto-refresh).
 *
 * OWNED BY: Competition feature (`src/competition/`).
 */

import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  useReverseVibhu,
  type ReverseTrade,
  type ReverseVibhuData,
} from "./useReverseVibhu";

export function ReverseVibhuView() {
  const { data, isLoading, isError, refetch } = useReverseVibhu();

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <Header />
      <main className="flex flex-col gap-4 p-3">
        <p className="px-1 text-xs leading-relaxed text-fg-muted">
          What if you traded the exact opposite of Vibhu, every trade?
        </p>
        {isLoading ? (
          <ReverseSkeleton />
        ) : isError || !data ? (
          <ErrorCard onRetry={() => refetch()} />
        ) : (
          <ReverseBody data={data} />
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Format a USD figure with optional sign + thousands separators. */
function fmtUsd(value: number, opts?: { sign?: boolean }): string {
  const sign = opts?.sign && value > 0 ? "+" : value < 0 ? "-" : "";
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

/** Compact USD with no decimals — for hero figures, e.g. `$13,046`. */
function fmtUsd0(value: number, opts?: { sign?: boolean }): string {
  const sign = opts?.sign && value > 0 ? "+" : value < 0 ? "-" : "";
  const body = Math.abs(Math.round(value)).toLocaleString("en-US");
  return `${sign}$${body}`;
}

/** Tailwind text colour for a signed value (green up / red down / neutral). */
function pnlColor(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-fg";
}

/** Format an ISO timestamp as a short "May 20, 04:42" label. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Body                                                                       */
/* -------------------------------------------------------------------------- */

function ReverseBody({ data }: { data: ReverseVibhuData }) {
  return (
    <>
      <Summary data={data} />
      <Sparkline trades={data.trades} startUsd={data.startUsd} />
      <TradeTable trades={data.trades} />
      <MarketBreakdown markets={data.markets} />
      <p className="px-1 pb-4 text-center text-[10px] leading-relaxed text-fg-subtle">
        Hypothetical only. The Reverse Index starts from an assumed $
        {data.startUsd.toLocaleString("en-US")} baseline and adds, per fill,{" "}
        <span className="font-mono">−realizedPnl − fees</span> — you mirror
        Vibhu&apos;s side so his realized PnL flips sign, but you still pay the
        same fee.
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

function Summary({ data }: { data: ReverseVibhuData }) {
  const { finalIndex, netPnl, tradeCount } = data;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent/50 bg-bg-elevated p-4">
      <div>
        <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          Reverse Vibhu Index
        </span>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums text-fg">
            {fmtUsd0(finalIndex)}
          </span>
          <span
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              pnlColor(netPnl),
            )}
          >
            {fmtUsd0(netPnl, { sign: true })}
          </span>
        </div>
        <span className="text-[10px] text-fg-subtle">
          fading every Vibhu trade, from a $
          {data.startUsd.toLocaleString("en-US")} baseline
        </span>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-border pt-3">
        <Stat
          label="Net PnL"
          value={fmtUsd(netPnl, { sign: true })}
          valueClassName={pnlColor(netPnl)}
        />
        <Stat label="Fills faded" value={String(tradeCount)} />
        <Stat
          label="His Realized"
          value={fmtUsd(data.hisGrossRealizedPnl, { sign: true })}
          valueClassName={pnlColor(data.hisGrossRealizedPnl)}
        />
      </div>
    </section>
  );
}

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

/* -------------------------------------------------------------------------- */
/* Sparkline — cumulative Reverse Index curve                                 */
/* -------------------------------------------------------------------------- */

function Sparkline({
  trades,
  startUsd,
}: {
  trades: ReverseTrade[];
  startUsd: number;
}) {
  if (trades.length === 0) return null;

  // Series includes the starting baseline point, then each running index.
  const series = [startUsd, ...trades.map((t) => t.runningIndex)];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  const W = 320;
  const H = 56;
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;

  const toY = (v: number) => H - ((v - min) / range) * H;
  const points = series
    .map((v, i) => `${(i * stepX).toFixed(2)},${toY(v).toFixed(2)}`)
    .join(" ");

  const last = series[series.length - 1];
  const up = last >= startUsd;
  const stroke = up ? "#4ade80" : "#f65a5a";

  // Baseline ($10k) reference line, if it sits within the visible range.
  const baselineY =
    startUsd >= min && startUsd <= max ? toY(startUsd) : null;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-4">
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        Reverse Index — cumulative
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-14 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {baselineY != null && (
          <line
            x1={0}
            y1={baselineY}
            x2={W}
            y2={baselineY}
            stroke="#3a2c1f"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-fg-subtle">
        <span className="font-mono tabular-nums">{fmtUsd0(startUsd)}</span>
        <span className="font-mono tabular-nums">{fmtUsd0(last)}</span>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-trade table                                                            */
/* -------------------------------------------------------------------------- */

function TradeTable({ trades }: { trades: ReverseTrade[] }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        Per-trade
      </span>
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated no-scrollbar">
        <table className="w-full min-w-[480px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-fg-subtle">
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Time</th>
              <th className="px-2 py-2 text-left font-medium">Market</th>
              <th className="px-2 py-2 text-right font-medium">His PnL</th>
              <th className="px-2 py-2 text-right font-medium">Fee</th>
              <th className="px-2 py-2 text-right font-medium">Reverted</th>
              <th className="px-2 py-2 text-right font-medium">Index</th>
            </tr>
          </thead>
          <tbody>
            {/* Computed oldest-first (running index); displayed newest-first. */}
            {[...trades].reverse().map((t) => (
              <tr
                key={t.index}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-2 py-1.5 text-left font-mono tabular-nums text-fg-subtle">
                  {t.index}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-left font-mono tabular-nums text-fg-muted">
                  {fmtTime(t.timestamp)}
                </td>
                <td className="px-2 py-1.5 text-left font-medium text-fg">
                  {t.marketSymbol}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-right font-mono tabular-nums",
                    pnlColor(t.hisRealizedPnl),
                  )}
                >
                  {fmtUsd(t.hisRealizedPnl, { sign: true })}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted">
                  {fmtUsd(t.fees)}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-right font-mono font-semibold tabular-nums",
                    pnlColor(t.revertedPnl),
                  )}
                >
                  {fmtUsd(t.revertedPnl, { sign: true })}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg">
                  {fmtUsd(t.runningIndex)}
                </td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-6 text-center text-xs text-fg-muted"
                >
                  No trades found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-market reverted breakdown                                              */
/* -------------------------------------------------------------------------- */

function MarketBreakdown({
  markets,
}: {
  markets: ReverseVibhuData["markets"];
}) {
  if (markets.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        Per-market — reverted PnL
      </span>
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-bg-elevated p-3">
        {markets.map((m) => (
          <div
            key={m.marketSymbol}
            className="flex items-center justify-between text-xs"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="font-medium text-fg">{m.marketSymbol}</span>
              <span className="text-[10px] text-fg-subtle">
                {m.count} {m.count === 1 ? "fill" : "fills"}
              </span>
            </span>
            <span
              className={cn(
                "font-mono font-semibold tabular-nums",
                pnlColor(m.revertedPnl),
              )}
            >
              {fmtUsd(m.revertedPnl, { sign: true })}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

function Header() {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-3">
      <Link
        href="/competition"
        className="-ml-1 flex h-7 w-7 items-center justify-center rounded-md text-fg-muted active:bg-bg-muted"
        aria-label="Back to challenge"
      >
        <span className="text-lg leading-none">‹</span>
      </Link>
      <div className="flex flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          Challenge
        </span>
        <h1 className="text-base font-semibold text-fg">
          Reverse Vibhu Index
        </h1>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function ReverseSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl bg-bg-elevated p-4">
        <div className="h-4 w-32 rounded bg-bg-muted" />
        <div className="h-9 w-40 rounded bg-bg-muted" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="h-8 rounded bg-bg-muted" />
          ))}
        </div>
      </div>
      <div className="h-24 rounded-xl bg-bg-elevated" />
      <div className="h-32 rounded-xl bg-bg-elevated" />
      <div className="h-64 rounded-xl bg-bg-elevated" />
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-down/40 bg-down-bg px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg">
        Could not load the Reverse Vibhu Index.
      </p>
      <p className="max-w-xs text-xs text-fg-muted">
        The Phoenix data feed did not respond. Check your connection and try
        again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md border border-border px-4 py-2 text-xs font-semibold text-fg active:bg-bg-muted"
      >
        Retry
      </button>
    </div>
  );
}
