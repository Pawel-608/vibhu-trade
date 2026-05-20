"use client";

/**
 * MarketDataView — the "Markets" bottom-nav view of the trade screen.
 *
 * Composes a market-stats strip, a Chart / Order Book / Trades tab switcher,
 * and a data row that toggles between the Trading agent's `Positions` and
 * `OpenOrders` panels (imported from `@/trading/*` — sanctioned cross-feature
 * import per CONTRACTS §4).
 *
 * Owns only layout + tab state; all data lives in the child components.
 *
 * OWNED BY: Market Data agent (`src/market-data/`).
 */

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Positions } from "@/trading/Positions";
import { OpenOrders } from "@/trading/OpenOrders";
import { TradesHistory } from "@/trading/TradesHistory";
import { Chart } from "./Chart";
import { OrderBook } from "./OrderBook";
import { TradesList } from "./TradesList";
import { MarketStatsStrip } from "./MarketStatsStrip";

export interface MarketDataViewProps {
  symbol: string;
}

const TABS = ["Chart", "Order Book", "Trades"] as const;
type Tab = (typeof TABS)[number];

const DATA_TABS = ["Positions", "Open Orders", "Trades"] as const;
type DataTab = (typeof DATA_TABS)[number];

export function MarketDataView({ symbol }: MarketDataViewProps) {
  const [tab, setTab] = useState<Tab>("Chart");
  const [dataTab, setDataTab] = useState<DataTab>("Positions");

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Live trading-challenge entry point */}
      <Link
        href="/competition"
        className="flex items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-bg px-3 py-2 active:opacity-80"
      >
        <span className="text-xs font-medium text-fg">
          <span aria-hidden>🏆</span> Vibhu vs Drew — live challenge
        </span>
        <span className="text-sm leading-none text-accent">›</span>
      </Link>

      {/* Live market stats */}
      <MarketStatsStrip symbol={symbol} />

      {/* Chart / Order Book / Trades switcher */}
      <div className="flex gap-5 border-b border-border">
        {TABS.map((t) => (
          <UnderlineTab key={t} active={tab === t} onClick={() => setTab(t)}>
            {t}
          </UnderlineTab>
        ))}
      </div>

      {tab === "Chart" && <Chart symbol={symbol} />}
      {tab === "Order Book" && <OrderBook symbol={symbol} />}
      {tab === "Trades" && <TradesList symbol={symbol} />}

      {/* Data row — Positions / Open Orders (owned by the Trading agent) */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-5 border-b border-border">
          {DATA_TABS.map((t) => (
            <UnderlineTab
              key={t}
              active={dataTab === t}
              onClick={() => setDataTab(t)}
            >
              {t}
            </UnderlineTab>
          ))}
        </div>
        {dataTab === "Positions" && <Positions symbol={symbol} />}
        {dataTab === "Open Orders" && <OpenOrders symbol={symbol} />}
        {dataTab === "Trades" && <TradesHistory />}
      </div>
    </div>
  );
}

function UnderlineTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 pb-2 text-xs font-medium transition-colors",
        active
          ? "border-accent text-fg"
          : "border-transparent text-fg-muted active:text-fg",
      )}
    >
      {children}
    </button>
  );
}
