"use client";

/**
 * Positions — the trader's open positions (PLAN.md §6).
 *
 * Live list with size, entry, mark, liq price, uPnL and account health, plus a
 * close-position action per row. Data comes from the connected trader's rich
 * `TraderView` (HTTP snapshot kept fresh by the WS `traderState` stream — see
 * `useTraderAccount`); the `TraderView` already carries the SDK's pre-computed
 * `liquidationPrice` / `unrealizedPnl` so no margin math is redone here.
 *
 * Close = a reduce-only market order in the opposite direction for the full
 * position size, built via `client.orderPackets` + `client.ixs` and submitted
 * through `submitTransaction`.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OrderFlags, type Position } from "@ellipsis-labs/rise";
import { cn } from "@/lib/cn";
import { CoinIcon } from "@/components/CoinIcon";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { submitTransaction } from "./submitTransaction";
import { useTraderAccount, TRADER_PDA_INDEX } from "./useTraderAccount";
import { useTxAction } from "./useTxAction";
import { AccountGatePrompt, InlineError } from "./AccountGate";
import { riskTierColor, riskTierLabel } from "./lib";

export interface PositionsProps {
  symbol?: string;
}

export function Positions({ symbol }: PositionsProps) {
  const account = useTraderAccount();
  const router = useRouter();

  if (account.status === "not-connected") {
    return (
      <AccountGatePrompt
        title="No positions"
        detail="Connect a wallet to see your open positions."
        action={{
          label: "Connect wallet",
          onClick: () => router.push("/login"),
        }}
        className="h-32"
      />
    );
  }
  if (account.status === "not-registered") {
    return (
      <AccountGatePrompt
        title="No positions"
        detail="Set up your Phoenix trader account to start trading."
        action={{
          label: "Complete onboarding",
          onClick: () => router.push("/onboarding"),
        }}
        className="h-32"
      />
    );
  }
  if (account.status === "loading") {
    return <ListSkeleton rows={2} />;
  }
  if (account.status === "error") {
    return (
      <InlineError
        message={account.error?.message ?? "Could not load positions."}
      />
    );
  }

  const view = account.view;
  const allPositions = view?.positions ?? [];
  // Show every open position (non-zero size). The current market's position is
  // pinned to the top; the rest keep their order (Array.sort is stable).
  const cur = symbol?.toUpperCase();
  const positions = allPositions
    .filter((p) => p.positionSize.value !== 0)
    .sort((a, b) => {
      if (!cur) return 0;
      const aCur = a.symbol.toUpperCase() === cur;
      const bCur = b.symbol.toUpperCase() === cur;
      return aCur === bCur ? 0 : aCur ? -1 : 1;
    });

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-5 text-center text-xs text-fg-muted">
        No open positions.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {view ? (
        <div className="flex items-center justify-between rounded-md bg-bg-muted px-3 py-1.5 text-[11px]">
          <span className="text-fg-muted">Account health</span>
          <span className={cn("font-semibold", riskTierColor(view.riskTier))}>
            {riskTierLabel(view.riskTier)}
          </span>
        </div>
      ) : null}
      {positions.map((position) => (
        <PositionRow key={position.symbol} position={position} />
      ))}
    </div>
  );
}

function PositionRow({ position }: { position: Position }) {
  const client = usePhoenixClient();
  const { wallet } = useWallet();
  const account = useTraderAccount();
  const tx = useTxAction();

  const sizeValue = position.positionSize.value;
  const isLong = sizeValue > 0;
  const upnl = position.unrealizedPnl.value;
  const upnlSign = upnl > 0 ? "up" : upnl < 0 ? "down" : "flat";

  async function handleClose() {
    if (!wallet || account.status !== "ready" || !account.authority) return;
    // `positionSize.value` is RAW base lots; `buildMarketOrderPacket` expects
    // the size in UI base units and scales it by the market's
    // `baseLotsDecimals`. Passing `.value` double-scaled the order (e.g. 17
    // lots -> 1700), and the reduce-only IOC then failed its minimum-fill
    // check. Use the UI amount, sign stripped.
    const absSize = position.positionSize.ui.replace(/^-/, "");

    await tx.run(
      async () => {
        // Close = reduce-only market order on the opposite side.
        const orderPacket = await client.orderPackets.buildMarketOrderPacket({
          symbol: position.symbol,
          // Long position -> sell (Ask) to close; short -> buy (Bid).
          side: isLong ? 1 : 0,
          baseUnits: absSize,
          orderFlags: OrderFlags.ReduceOnly,
        });
        const ix = await client.ixs.buildPlaceMarketOrder({
          authority: account.authority as never,
          symbol: position.symbol,
          orderPacket,
          traderPdaIndex: TRADER_PDA_INDEX,
        });
        return submitTransaction({ client, wallet, instructions: ix });
      },
      {
        pending: `Closing ${position.symbol} position…`,
        success: "Position closed.",
      },
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elevated p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CoinIcon symbol={position.symbol} size={20} />
          <span className="text-sm font-semibold text-fg">{position.symbol}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              isLong ? "bg-up-bg text-up" : "bg-down-bg text-down",
            )}
          >
            {isLong ? "LONG" : "SHORT"}
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-sm font-semibold",
            upnlSign === "up" && "text-up",
            upnlSign === "down" && "text-down",
            upnlSign === "flat" && "text-fg-muted",
          )}
        >
          {upnl >= 0 ? "+" : ""}
          {position.unrealizedPnl.ui}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <Stat
          label="Size"
          value={position.positionSize.ui.replace(/^-/, "")}
        />
        <Stat label="Notional" value={`$${position.positionValue.ui}`} />
        <Stat label="Entry" value={`$${position.entryPrice.ui}`} />
        <Stat
          label="Liq. price"
          value={`$${position.liquidationPrice.ui}`}
          accent="down"
        />
        <Stat label="Margin" value={`$${position.initialMargin.ui}`} />
        <Stat
          label="Funding"
          value={position.accumulatedFunding.ui}
        />
      </div>

      <button
        type="button"
        disabled={tx.isPending || account.status !== "ready"}
        onClick={handleClose}
        className="rounded-md bg-bg-muted py-2 text-xs font-semibold text-fg active:bg-border disabled:opacity-40"
      >
        {tx.isPending ? "Closing…" : "Close Position (Market)"}
      </button>

      {tx.state.phase === "error" && tx.state.message ? (
        <InlineError message={tx.state.message} />
      ) : null}
      {tx.state.phase === "success" ? (
        <div className="rounded-md border border-up/40 bg-up-bg px-3 py-1.5 text-[11px] text-up">
          {tx.state.message}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "up" | "down";
}) {
  return (
    <div className="flex justify-between">
      <span className="text-fg-subtle">{label}</span>
      <span
        className={cn(
          "font-mono text-fg",
          accent === "up" && "text-up",
          accent === "down" && "text-down",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-bg-elevated"
        />
      ))}
    </div>
  );
}
