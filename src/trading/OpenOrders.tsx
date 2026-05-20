"use client";

/**
 * OpenOrders — the trader's resting limit orders, with cancel actions (PLAN.md §6).
 *
 * Data comes from the connected trader's rich `TraderView.limitOrders` (a
 * `Record<symbol, LimitOrder[]>`), kept fresh by the WS `traderState` stream via
 * `useTraderAccount`.
 *
 * Cancel-by-id  -> `client.ixs.buildCancelOrdersById`.
 * Cancel-all    -> `client.ixs.buildCancelAll` (per market — one ix per symbol).
 * Both are submitted through `submitTransaction`.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useRouter } from "next/navigation";
import { Side, symbol as toSymbol, type LimitOrder } from "@ellipsis-labs/rise";
import { cn } from "@/lib/cn";
import { CoinIcon } from "@/components/CoinIcon";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { submitTransaction, type RiseInstruction } from "./submitTransaction";
import { useTraderAccount, TRADER_PDA_INDEX } from "./useTraderAccount";
import { useTxAction } from "./useTxAction";
import { AccountGatePrompt, InlineError } from "./AccountGate";

export interface OpenOrdersProps {
  symbol?: string;
}

interface FlatOrder {
  symbol: string;
  order: LimitOrder;
}

export function OpenOrders({ symbol }: OpenOrdersProps) {
  const client = usePhoenixClient();
  const { wallet } = useWallet();
  const account = useTraderAccount();
  const tx = useTxAction();
  const router = useRouter();

  if (account.status === "not-connected") {
    return (
      <AccountGatePrompt
        title="No open orders"
        detail="Connect a wallet to see your resting orders."
        action={{
          label: "Connect wallet",
          onClick: () => router.push("/login"),
        }}
        className="h-28"
      />
    );
  }
  if (account.status === "not-registered") {
    return (
      <AccountGatePrompt
        title="No open orders"
        detail="Set up your Phoenix trader account to start trading."
        action={{
          label: "Complete onboarding",
          onClick: () => router.push("/onboarding"),
        }}
        className="h-28"
      />
    );
  }
  if (account.status === "loading") {
    return <ListSkeleton rows={2} />;
  }
  if (account.status === "error") {
    return (
      <InlineError
        message={account.error?.message ?? "Could not load open orders."}
      />
    );
  }

  // Flatten the per-market order map; optionally filter to one symbol.
  const limitOrders = account.view?.limitOrders ?? {};
  const flat: FlatOrder[] = [];
  for (const [marketSymbol, orders] of Object.entries(limitOrders)) {
    if (symbol && marketSymbol.toUpperCase() !== symbol.toUpperCase()) continue;
    for (const order of orders) {
      flat.push({ symbol: marketSymbol, order });
    }
  }

  if (flat.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-5 text-center text-xs text-fg-muted">
        No open orders{symbol ? ` in ${symbol}` : ""}.
      </div>
    );
  }

  async function cancelOne(target: FlatOrder) {
    if (!wallet || account.status !== "ready" || !account.authority) return;
    await tx.run(
      async () => {
        const ix = await client.ixs.buildCancelOrdersById({
          authority: account.authority as never,
          symbol: toSymbol(target.symbol),
          traderPdaIndex: TRADER_PDA_INDEX,
          orders: [
            {
              price: target.order.price.value,
              orderSequenceNumber: target.order.orderSequenceNumber,
            },
          ],
        });
        return submitTransaction({ client, wallet, instructions: ix });
      },
      { pending: "Cancelling order…", success: "Order cancelled." },
    );
  }

  async function cancelAll() {
    if (!wallet || account.status !== "ready" || !account.authority) return;
    // One cancel-all instruction per market that has resting orders.
    const symbols = Array.from(new Set(flat.map((f) => f.symbol)));
    await tx.run(
      async () => {
        const ixs: RiseInstruction[] = [];
        for (const marketSymbol of symbols) {
          const ix = await client.ixs.buildCancelAll({
            authority: account.authority as never,
            symbol: toSymbol(marketSymbol),
            traderPdaIndex: TRADER_PDA_INDEX,
          });
          ixs.push(ix);
        }
        return submitTransaction({ client, wallet, instructions: ixs });
      },
      { pending: "Cancelling all orders…", success: "All orders cancelled." },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-fg-muted">
          {flat.length} open order{flat.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          disabled={tx.isPending}
          onClick={cancelAll}
          className="text-[11px] font-semibold text-down active:opacity-70 disabled:opacity-40"
        >
          Cancel all
        </button>
      </div>

      {flat.map(({ symbol: marketSymbol, order }) => (
        <OrderRow
          key={`${marketSymbol}-${order.orderSequenceNumber}`}
          symbol={marketSymbol}
          order={order}
          disabled={tx.isPending}
          onCancel={() => cancelOne({ symbol: marketSymbol, order })}
        />
      ))}

      {tx.state.phase === "error" && tx.state.message ? (
        <InlineError message={tx.state.message} />
      ) : null}
      {tx.state.phase === "success" && tx.state.message ? (
        <div className="rounded-md border border-up/40 bg-up-bg px-3 py-1.5 text-[11px] text-up">
          {tx.state.message}
        </div>
      ) : null}
    </div>
  );
}

function OrderRow({
  symbol,
  order,
  disabled,
  onCancel,
}: {
  symbol: string;
  order: LimitOrder;
  disabled: boolean;
  onCancel: () => void;
}) {
  const isBuy = order.side === Side.Bid;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <CoinIcon symbol={symbol} size={20} />
          <span className="text-sm font-semibold text-fg">{symbol}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              isBuy ? "bg-up-bg text-up" : "bg-down-bg text-down",
            )}
          >
            {isBuy ? "BUY" : "SELL"}
          </span>
          <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
            LIMIT
          </span>
          {order.isReduceOnly ? (
            <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
              RO
            </span>
          ) : null}
        </div>
        <div className="flex gap-3 text-[11px] text-fg-muted">
          <span>
            Price{" "}
            <span className="font-mono text-fg">${order.price.ui}</span>
          </span>
          <span>
            Size{" "}
            <span className="font-mono text-fg">
              {order.tradeSizeRemaining.ui}
            </span>
          </span>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onCancel}
        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-down active:bg-bg-muted disabled:opacity-40"
      >
        Cancel
      </button>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-bg-elevated"
        />
      ))}
    </div>
  );
}
