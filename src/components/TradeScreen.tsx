"use client";

/**
 * TradeScreen — THE main screen (PLAN.md §7).
 *
 * One trade screen is the hub. A 3-item bottom nav (Markets · Trade · Account)
 * toggles in-page views — these are NOT separate routes. The market header
 * opens a full-screen market-selector overlay. Switching market navigates the
 * `/trade/[symbol]` route; the view toggle is local client state.
 *
 * SHARED app-shell component (`src/components/`). It wires together the four
 * feature areas; feature agents fill in their own components, not this file.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TradeView } from "@/types";
import { tradeRoute } from "@/lib/constants";
import { BottomNav } from "./BottomNav";
import { MarketHeader } from "@/market-data/MarketHeader";
import { MarketSelector } from "@/market-data/MarketSelector";
import { MarketDataView } from "@/market-data/MarketDataView";
import { TradeView as TradeOrderView } from "@/trading/TradeView";
import { AccountView } from "@/account/AccountView";

export interface TradeScreenProps {
  symbol: string;
}

export function TradeScreen({ symbol }: TradeScreenProps) {
  const router = useRouter();
  const [view, setView] = useState<TradeView>("markets");
  const [selectorOpen, setSelectorOpen] = useState(false);

  function handleSelectMarket(nextSymbol: string) {
    setSelectorOpen(false);
    if (nextSymbol !== symbol) {
      router.push(tradeRoute(nextSymbol));
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-app flex-col bg-bg">
      <MarketHeader
        symbol={symbol}
        onOpenSelector={() => setSelectorOpen(true)}
      />

      <main className="flex-1 overflow-y-auto">
        {view === "markets" && <MarketDataView symbol={symbol} />}
        {view === "trade" && <TradeOrderView symbol={symbol} />}
        {view === "account" && <AccountView />}
      </main>

      <BottomNav active={view} onChange={setView} />

      <MarketSelector
        open={selectorOpen}
        currentSymbol={symbol}
        onSelect={handleSelectMarket}
        onClose={() => setSelectorOpen(false)}
      />
    </div>
  );
}
