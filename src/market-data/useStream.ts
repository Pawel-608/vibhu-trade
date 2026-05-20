"use client";

/**
 * useStream — shared live-data helpers for the Market Data feature.
 *
 * The Rise SDK exposes every WS channel as an `AsyncIterable` adapter
 * (`client.streams.l2Book(...)`, `.markPrice(...)`, `.candles(...)`, etc).
 * Per PLAN.md §3 we must NOT `setState` per inbound message — instead we
 * buffer the most-recent value and flush it on `requestAnimationFrame`.
 *
 * `useStreamLatest` consumes an async iterable, keeps only the latest value,
 * and re-renders at most once per animation frame.
 *
 * `useStreamBuffer` accumulates messages into a bounded ring buffer (used by
 * the trades feed) and flushes the whole buffer on rAF.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useEffect, useRef, useState } from "react";

/** Run an async iterable, surfacing only the most recent value, rAF-batched. */
export function useStreamLatest<T>(
  /** Factory producing the async iterable for the given abort signal. */
  subscribe: ((signal: AbortSignal) => AsyncIterable<T>) | null,
  /** Re-subscribe whenever any dependency changes. */
  deps: readonly unknown[],
): T | null {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    setValue(null);
    if (!subscribe) return;

    const controller = new AbortController();
    let pending: T | null = null;
    let hasPending = false;
    let rafId: number | null = null;
    let disposed = false;

    const flush = () => {
      rafId = null;
      if (!hasPending || disposed) return;
      hasPending = false;
      setValue(pending);
    };

    const schedule = () => {
      if (rafId != null) return;
      rafId =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(flush)
          : (setTimeout(flush, 16) as unknown as number);
    };

    (async () => {
      try {
        for await (const item of subscribe(controller.signal)) {
          if (disposed) break;
          pending = item;
          hasPending = true;
          schedule();
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          // Background stream error — surface to console, keep last value.
          console.error("[market-data] stream error", err);
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      if (rafId != null) {
        if (typeof cancelAnimationFrame === "function")
          cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}

/**
 * Run an async iterable that emits batches/items and accumulate them into a
 * bounded, newest-first list. Flushes on rAF so a burst of fills re-renders
 * the list once per frame.
 */
export function useStreamBuffer<TMsg, TItem>(
  subscribe: ((signal: AbortSignal) => AsyncIterable<TMsg>) | null,
  /** Map an inbound message into zero or more list items (newest first). */
  extract: (msg: TMsg) => TItem[],
  /** Maximum retained items. */
  capacity: number,
  deps: readonly unknown[],
): TItem[] {
  const [items, setItems] = useState<TItem[]>([]);
  const extractRef = useRef(extract);
  extractRef.current = extract;

  useEffect(() => {
    setItems([]);
    if (!subscribe) return;

    const controller = new AbortController();
    let buffer: TItem[] = [];
    let dirty = false;
    let rafId: number | null = null;
    let disposed = false;

    const flush = () => {
      rafId = null;
      if (!dirty || disposed) return;
      dirty = false;
      setItems(buffer);
    };

    const schedule = () => {
      if (rafId != null) return;
      rafId =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(flush)
          : (setTimeout(flush, 16) as unknown as number);
    };

    (async () => {
      try {
        for await (const msg of subscribe(controller.signal)) {
          if (disposed) break;
          const next = extractRef.current(msg);
          if (next.length === 0) continue;
          buffer = [...next, ...buffer].slice(0, capacity);
          dirty = true;
          schedule();
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[market-data] stream buffer error", err);
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      if (rafId != null) {
        if (typeof cancelAnimationFrame === "function")
          cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return items;
}
