"use client";

/**
 * Chart — candlestick price chart (TradingView `lightweight-charts` v5).
 *
 * Seeds the candlestick + volume series from the candles HTTP endpoint
 * (`client.api.candles().getCandles`) and keeps them live via the WS
 * `candle` stream (`client.streams.candles(symbol, timeframe)`). Candle
 * timestamps are epoch milliseconds (API-RECON.md) — lightweight-charts wants
 * UTC seconds, so we divide by 1000. WS updates flow through `useStreamLatest`
 * which rAF-batches them; each flush calls `series.update(...)`.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useEffect, useState, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ApiCandle, CandleUpdate } from "@ellipsis-labs/rise";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useStreamLatest } from "./useStream";
// Market Data is allowed to read Trading state (CONTRACTS §4) — used here to
// draw the connected trader's entry price for the charted market.
import { useTraderAccount } from "@/trading/useTraderAccount";

export interface ChartProps {
  symbol: string;
  timeframe?: string;
}

/** Selectable candle intervals (per PLAN.md / API timeframe values). */
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const CANDLE_LIMIT = 500;

// Candle colors track trading semantics: green = up, red = down.
const UP = "#4ade80";
const DOWN = "#f65a5a";
// Phoenix orange accent (mirrors the `accent` Tailwind token) — used for the
// price line so it reads as a brand/UI element, distinct from price direction.
const ACCENT = "#ffa548";

/** Convert an ms-epoch candle time to lightweight-charts UTC seconds. */
function toChartTime(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function toCandleData(c: ApiCandle): CandlestickData {
  return {
    time: toChartTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function toVolumeData(c: { time: number; close: number; open: number; volume: number }): HistogramData {
  return {
    time: toChartTime(c.time),
    value: c.volume,
    color: c.close >= c.open ? "rgba(74,222,128,0.3)" : "rgba(246,90,90,0.3)",
  };
}

/** Resolve the initial timeframe from the optional prop, defaulting to "1h". */
function initialTimeframe(initial?: string): Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(initial ?? "")
    ? (initial as Timeframe)
    : "1h";
}

export function Chart({ symbol, timeframe }: ChartProps) {
  const client = usePhoenixClient();
  const [tf, setTf] = useState<Timeframe>(() => initialTimeframe(timeframe));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Historical candles — one-shot HTTP read, cached per (symbol, timeframe).
  // The query key includes `tf`, so switching timeframe fetches a fresh
  // series (a different cache entry) rather than reusing stale candles.
  const {
    data: candles,
    isLoading,
    isError,
    refetch,
  } = useQuery<ApiCandle[]>({
    queryKey: ["candles", symbol, tf],
    queryFn: () =>
      client.api
        .candles()
        .getCandles(symbol, { timeframe: tf, limit: CANDLE_LIMIT }),
    staleTime: 15_000,
    enabled: symbol.length > 0,
  });

  // Live candle updates via WS `candle` channel. The subscription factory and
  // the effect deps both close over `tf`, so changing timeframe tears down the
  // old `candles:<sym>:<oldTf>` subscription and opens `candles:<sym>:<tf>`.
  const liveCandle = useStreamLatest<CandleUpdate>(
    client.streams
      ? (signal) => client.streams!.candles(symbol, tf, signal)
      : null,
    [client, symbol, tf],
  );

  // The connected trader's open position in THIS market, if any. Matched by
  // symbol so the entry line is only drawn for the asset actually charted; a
  // closed/absent position (or no wallet) yields a null `entryPrice`.
  const account = useTraderAccount();
  const myPosition =
    account.status === "ready"
      ? account.view?.positions?.find(
          (p) =>
            p.symbol.toUpperCase() === symbol.toUpperCase() &&
            p.positionSize.value !== 0,
        )
      : undefined;
  const entryPrice = myPosition
    ? Number.parseFloat(myPosition.entryPrice.ui.replace(/,/g, ""))
    : null;
  const positionIsLong = (myPosition?.positionSize.value ?? 0) > 0;

  // Create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: "#0c0a09" },
        textColor: "#b59a82",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(58,44,31,0.6)" },
        horzLines: { color: "rgba(58,44,31,0.6)" },
      },
      rightPriceScale: { borderColor: "#3a2c1f" },
      timeScale: {
        borderColor: "#3a2c1f",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      autoSize: true,
      // Allow dragging the price (y) and time (x) axes to scale/zoom.
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: true,
      priceLineColor: ACCENT,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Reset the series the instant the timeframe (or symbol) changes — before
  // the new history resolves. Otherwise the previous timeframe's candles stay
  // drawn during the fetch, and live WS updates for the NEW timeframe land on
  // a series still holding OLD-timeframe data: lightweight-charts requires
  // monotonic time ordering across `update()` calls, so mixing resolutions
  // makes the chart fail to switch. Clearing here guarantees a clean redraw.
  useEffect(() => {
    candleSeriesRef.current?.setData([]);
    volumeSeriesRef.current?.setData([]);
  }, [symbol, tf]);

  // Seed the series whenever historical candles arrive. Keyed by `tf`/`symbol`
  // as well as `candles` so a timeframe switch always re-seeds, even when
  // TanStack Query serves a referentially-stable cached array.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !candles) return;

    // Candles arrive oldest-first; lightweight-charts wants ascending time.
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    candleSeries.setData(sorted.map(toCandleData));
    volumeSeries.setData(sorted.map(toVolumeData));
    chartRef.current?.timeScale().fitContent();
  }, [candles, symbol, tf]);

  // Apply live candle updates (rAF-batched upstream). Drop any update whose
  // symbol/timeframe does not match the current selection — this guards
  // against an in-flight update from the previous subscription arriving after
  // a timeframe switch and corrupting the new series' time ordering.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !liveCandle) return;
    if (liveCandle.symbol !== symbol || liveCandle.timeframe !== tf) return;

    const c = liveCandle.candle;
    candleSeries.update({
      time: toChartTime(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
    volumeSeries.update({
      time: toChartTime(c.time),
      value: c.volume,
      color:
        c.close >= c.open
          ? "rgba(74,222,128,0.3)"
          : "rgba(246,90,90,0.3)",
    });
  }, [liveCandle, symbol, tf]);

  // Draw a dashed horizontal line at the trader's entry price for this market.
  // Price lines are independent of series data, so they survive the `setData`
  // resets on symbol/timeframe switches. The effect re-runs whenever the entry
  // price or its direction changes — cleanup removes the stale line — and the
  // line simply disappears once the position is closed (`entryPrice` -> null).
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || entryPrice == null || !Number.isFinite(entryPrice)) return;

    const line = series.createPriceLine({
      price: entryPrice,
      color: positionIsLong ? UP : DOWN,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: positionIsLong ? "Long entry" : "Short entry",
    });
    return () => {
      series.removePriceLine(line);
    };
  }, [entryPrice, positionIsLong]);

  return (
    <div className="flex flex-col gap-2">
      {/* Timeframe selector */}
      <div className="flex items-center gap-4">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTf(t)}
            className={cn(
              "text-[11px] font-medium tabular-nums transition-colors",
              tf === t ? "text-accent" : "text-fg-muted active:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Chart canvas */}
      <div className="relative h-64 w-full overflow-hidden rounded-md bg-bg">
        <div ref={containerRef} className="h-full w-full" />
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">
            Loading chart…
          </div>
        ) : isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-fg-muted">
            <span>Could not load candles.</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border border-border px-3 py-1 text-fg active:bg-bg-muted"
            >
              Retry
            </button>
          </div>
        ) : candles && candles.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">
            No candle data.
          </div>
        ) : null}
      </div>
    </div>
  );
}
