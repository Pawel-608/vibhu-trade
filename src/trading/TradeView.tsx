"use client";

/**
 * TradeView — the "Trade" bottom-nav view of the trade screen (PLAN.md §7).
 *
 * Composes the order-entry ticket (full-height) plus the trader's live
 * Positions and OpenOrders so they can act on a fill without leaving the view.
 * Owns layout only — data lives in the child components, which each read the
 * connected trader's live state.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useState } from "react";
import { cn } from "@/lib/cn";
import { OrderEntry } from "./OrderEntry";
import { Positions } from "./Positions";
import { OpenOrders } from "./OpenOrders";

export interface TradeViewProps {
  symbol: string;
}

type ActivityTab = "positions" | "orders";

export function TradeView({ symbol }: TradeViewProps) {
  const [tab, setTab] = useState<ActivityTab>("positions");

  return (
    <div className="mx-auto flex w-full max-w-app flex-col gap-5 p-3 pb-nav">
      <OrderEntry symbol={symbol} />

      <section className="flex flex-col gap-3">
        <div className="flex gap-5 border-b border-border">
          <TabButton
            active={tab === "positions"}
            onClick={() => setTab("positions")}
          >
            Positions
          </TabButton>
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
            Open Orders
          </TabButton>
        </div>

        {tab === "positions" ? (
          <Positions symbol={symbol} />
        ) : (
          <OpenOrders symbol={symbol} />
        )}
      </section>
    </div>
  );
}

function TabButton({
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
