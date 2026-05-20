"use client";

/**
 * BottomNav — the 3-item bottom nav of the trade screen.
 *
 * Per PLAN.md §7, these are *view toggles within the active market*, NOT
 * separate routes. The active view is client-side state owned by the trade
 * screen; this component is purely presentational.
 *
 * SHARED app-shell component (`src/components/`). Feature agents should not
 * edit this — it is part of the skeleton routing/shell contract.
 */

import type { TradeView } from "@/types";
import { TRADE_VIEWS } from "@/lib/constants";
import { cn } from "@/lib/cn";

const LABELS: Record<TradeView, string> = {
  markets: "Markets",
  trade: "Trade",
  account: "Account",
};

export interface BottomNavProps {
  active: TradeView;
  onChange: (view: TradeView) => void;
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="sticky bottom-0 z-40 flex h-nav shrink-0 border-t border-border bg-bg">
      {TRADE_VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => onChange(view)}
          className={cn(
            "flex flex-1 items-center justify-center text-xs font-medium tracking-wide transition-colors",
            active === view ? "text-accent" : "text-fg-muted active:text-fg",
          )}
          aria-current={active === view ? "page" : undefined}
        >
          {LABELS[view]}
        </button>
      ))}
    </nav>
  );
}
