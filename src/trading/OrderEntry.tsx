"use client";

/**
 * OrderEntry — the order ticket (PLAN.md §7).
 *
 * Order type (Market / Limit), side (Buy/Long, Sell/Short), margin mode
 * (Cross / Isolated), leverage, price (limit only), size with a % slider,
 * reduce-only, and a live Liquidation Price / Order Value / Margin Required
 * summary. v1 = market & limit orders only — TP/SL is v2.
 *
 * Flow: build the order packet via `client.orderPackets`, the instruction via
 * `client.ixs` (Flight-wrapped automatically when the client carries a `flight`
 * config), then submit via `submitTransaction`.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderFlags, symbol as toSymbol } from "@ellipsis-labs/rise";
import type { Side as AppSide, OrderType, MarginMode } from "@/types";
import { cn } from "@/lib/cn";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { submitTransaction } from "./submitTransaction";
import { useTraderAccount, useMarketSnapshot, TRADER_PDA_INDEX } from "./useTraderAccount";
import { useMarkPrice } from "./useMarkPrice";
import { useTxAction } from "./useTxAction";
import { AccountGatePrompt, InlineError } from "./AccountGate";
import { CollateralActions } from "@/account/CollateralActions";
import {
  clampLeverage,
  estimateOrder,
  formatMicrosUsd,
  isValidDecimal,
  maxLeverageForMarket,
  toSdkSide,
  usdToMicros,
} from "./lib";

export interface OrderEntryProps {
  symbol: string;
  initialSide?: AppSide;
  initialPrice?: string;
}

/** Slippage allowance for market orders (2% — mirrors SDK default). */
const MARKET_SLIPPAGE = 0.02;

export function OrderEntry({ symbol, initialSide, initialPrice }: OrderEntryProps) {
  const client = usePhoenixClient();
  const router = useRouter();
  const { wallet } = useWallet();
  const account = useTraderAccount();
  const marketQuery = useMarketSnapshot(symbol);
  const { markPrice } = useMarkPrice(symbol);
  const tx = useTxAction();

  const [orderType, setOrderType] = useState<OrderType>("market");
  const [side, setSide] = useState<AppSide>(initialSide ?? "long");
  const [marginMode, setMarginMode] = useState<MarginMode>("cross");
  const [leverage, setLeverage] = useState<number>(2);
  const [price, setPrice] = useState<string>(initialPrice ?? "");
  const [size, setSize] = useState<string>("");
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);

  const market = marketQuery.data ?? null;
  const maxLeverage = market ? maxLeverageForMarket(market) : 20;

  // Reference price: limit price for limit orders, mark price for market orders.
  const refPriceStr =
    orderType === "limit"
      ? price
      : markPrice != null
        ? markPrice.toString()
        : "";

  // Free collateral (micro-USD) available to back a new order.
  const freeCollateralMicros = useMemo(() => {
    if (!account.view) return 0n;
    const effective = usdToMicros(account.view.effectiveCollateral.ui);
    const initial = usdToMicros(account.view.initialMargin.ui);
    const free = effective - initial;
    return free > 0n ? free : 0n;
  }, [account.view]);

  const estimate = useMemo(() => {
    if (!market) {
      return { orderValueMicros: 0n, marginRequiredMicros: 0n, liquidationPriceMicros: null };
    }
    return estimateOrder({
      side,
      sizeUnits: size,
      priceUsd: refPriceStr,
      leverage,
      market,
    });
  }, [market, side, size, refPriceStr, leverage]);

  // Size % slider: % of the max size the free collateral could open at `leverage`.
  const sizePercent = useMemo(() => {
    if (freeCollateralMicros <= 0n || estimate.marginRequiredMicros <= 0n) return 0;
    const pct =
      Number((estimate.marginRequiredMicros * 1000n) / freeCollateralMicros) / 10;
    return Math.min(100, Math.max(0, Math.round(pct)));
  }, [estimate.marginRequiredMicros, freeCollateralMicros]);

  function applySizePercent(pct: number) {
    if (!market || freeCollateralMicros <= 0n) return;
    const refMicros = usdToMicros(refPriceStr);
    if (refMicros <= 0n) return;
    // budgetValue = freeCollateral * leverage * pct/100
    const budgetMicros =
      (freeCollateralMicros * BigInt(leverage) * BigInt(Math.round(pct))) / 100n;
    // size units = budgetValue / price
    const sizeMicros = (budgetMicros * 1_000_000n) / refMicros;
    const whole = sizeMicros / 1_000_000n;
    const frac = (sizeMicros % 1_000_000n).toString().padStart(6, "0").slice(0, 4);
    setSize(`${whole}.${frac}`);
  }

  const priceInvalid =
    orderType === "limit" && (!isValidDecimal(price) || usdToMicros(price) <= 0n);
  const sizeInvalid = !isValidDecimal(size) || usdToMicros(size) <= 0n;
  const noRefPrice = usdToMicros(refPriceStr) <= 0n;

  const canSubmit =
    account.status === "ready" &&
    !!market &&
    !priceInvalid &&
    !sizeInvalid &&
    !noRefPrice &&
    !tx.isPending;

  async function handleSubmit() {
    if (!market || !wallet || account.status !== "ready") return;

    const result = await tx.run(
      async () => {
        const sdkSide = toSdkSide(side);
        const orderFlags = reduceOnly ? OrderFlags.ReduceOnly : OrderFlags.None;

        if (orderType === "limit") {
          const orderPacket = await client.orderPackets.buildLimitOrderPacket({
            symbol,
            side: sdkSide,
            priceUsd: price,
            baseUnits: size,
            orderFlags,
          });
          const ix = await client.ixs.buildPlaceLimitOrder({
            authority: account.authority as never,
            symbol: toSymbol(symbol),
            orderPacket,
            traderPdaIndex: TRADER_PDA_INDEX,
          });
          return submitTransaction({ client, wallet, instructions: ix });
        }

        // Market order — apply a slippage-protected price limit off the mark.
        const mark = markPrice ?? 0;
        const limitUsd =
          mark > 0
            ? side === "long"
              ? (mark * (1 + MARKET_SLIPPAGE)).toString()
              : (mark * (1 - MARKET_SLIPPAGE)).toString()
            : undefined;
        const orderPacket = await client.orderPackets.buildMarketOrderPacket({
          symbol,
          side: sdkSide,
          baseUnits: size,
          priceLimitUsd: limitUsd,
          orderFlags,
        });
        const ix = await client.ixs.buildPlaceMarketOrder({
          authority: account.authority as never,
          symbol: toSymbol(symbol),
          orderPacket,
          traderPdaIndex: TRADER_PDA_INDEX,
        });
        return submitTransaction({ client, wallet, instructions: ix });
      },
      {
        pending: `Placing ${orderType} ${side === "long" ? "buy" : "sell"} order…`,
        success: "Order placed.",
      },
    );
    // Clear the size field once the order has been submitted (a `result`
    // means it landed on-chain — a confirmation timeout still returns one).
    if (result) setSize("");
  }

  // --- Gating states -------------------------------------------------------
  if (account.status === "not-connected") {
    return (
      <AccountGatePrompt
        title="Connect a wallet to trade"
        detail="Phoenix perps is invite-gated. Connect your wallet, then activate your invite to start trading."
        action={{
          label: "Connect wallet",
          onClick: () => router.push("/login"),
        }}
        className="h-72"
      />
    );
  }
  if (account.status === "not-registered") {
    return (
      <AccountGatePrompt
        title="Trader account not set up"
        detail="This wallet has no Phoenix trader account yet. Complete onboarding (invite activation + trader registration) to place orders."
        action={{
          label: "Complete onboarding",
          onClick: () => router.push("/onboarding"),
        }}
        className="h-72"
      />
    );
  }
  if (account.status === "loading" || marketQuery.isLoading) {
    return <OrderEntrySkeleton />;
  }
  if (account.status === "error") {
    return (
      <div className="p-1">
        <InlineError
          message={account.error?.message ?? "Could not load your trader account."}
        />
      </div>
    );
  }
  if (!market) {
    return (
      <div className="p-1">
        <InlineError message={`Market "${symbol}" is unavailable.`} />
      </div>
    );
  }

  // Account is ready but holds no collateral — no order can be placed yet.
  // Surface the deposit flow right here in the Trade tab so the user can fund
  // and trade without hopping over to the Account tab.
  const hasCollateral =
    account.view != null &&
    usdToMicros(account.view.effectiveCollateral.ui) > 0n;
  if (!hasCollateral) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-bg-elevated p-4 text-center">
          <p className="text-sm font-semibold text-fg">No collateral yet</p>
          <p className="mt-1 text-xs leading-snug text-fg-muted">
            Deposit USDC to start trading {symbol}.
          </p>
        </div>
        <CollateralActions onChanged={account.refetch} />
      </div>
    );
  }

  const isLong = side === "long";

  return (
    <div className="flex flex-col gap-3">
      {/* Order type */}
      <SegmentedControl
        options={[
          { value: "market", label: "Market" },
          { value: "limit", label: "Limit" },
        ]}
        value={orderType}
        onChange={(v) => setOrderType(v as OrderType)}
      />

      {/* Side */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("long")}
          className={cn(
            "rounded-md py-2.5 text-sm font-semibold transition-colors",
            isLong
              ? "bg-up text-bg"
              : "bg-bg-muted text-fg-muted active:text-fg",
          )}
        >
          Buy / Long
        </button>
        <button
          type="button"
          onClick={() => setSide("short")}
          className={cn(
            "rounded-md py-2.5 text-sm font-semibold transition-colors",
            !isLong
              ? "bg-down text-bg"
              : "bg-bg-muted text-fg-muted active:text-fg",
          )}
        >
          Sell / Short
        </button>
      </div>

      {/* Margin mode + leverage */}
      <div className="flex items-center gap-2">
        <SegmentedControl
          className="flex-1"
          options={[
            { value: "cross", label: "Cross" },
            // Isolated margin needs a dedicated on-chain subaccount, which the
            // app does not create yet — disabled until that ships.
            { value: "isolated", label: "Isolated (soon)", disabled: true },
          ]}
          value={marginMode}
          onChange={(v) => setMarginMode(v as MarginMode)}
        />
        <div className="flex items-center gap-1 rounded-md bg-bg-muted px-2 py-1.5 text-xs">
          <span className="text-fg-muted">Lev</span>
          <span className="font-mono font-semibold text-fg">{leverage}x</span>
        </div>
      </div>

      {/* Leverage slider */}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={Math.max(2, Math.floor(maxLeverage))}
          step={1}
          value={leverage}
          onChange={(e) =>
            setLeverage(clampLeverage(Number(e.target.value), maxLeverage))
          }
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-bg-muted accent-accent"
        />
        <span className="w-12 text-right font-mono text-xs text-fg-muted">
          {Math.floor(maxLeverage)}x max
        </span>
      </div>

      {/* Price (limit only) */}
      {orderType === "limit" ? (
        <Field
          label="Price (USD)"
          value={price}
          onChange={setPrice}
          placeholder={markPrice != null ? markPrice.toFixed(2) : "0.00"}
          invalid={priceInvalid && price !== ""}
          suffix={
            markPrice != null ? (
              <button
                type="button"
                onClick={() => setPrice(markPrice.toFixed(2))}
                className="text-[10px] font-semibold text-accent"
              >
                MARK
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex items-center justify-between rounded-md bg-bg-muted px-3 py-2 text-xs">
          <span className="text-fg-muted">Market price</span>
          <span className="font-mono text-fg">
            {markPrice != null ? `$${markPrice.toFixed(2)}` : "—"}
          </span>
        </div>
      )}

      {/* Size */}
      <Field
        label={`Size (${symbol})`}
        value={size}
        onChange={setSize}
        placeholder="0.00"
        invalid={sizeInvalid && size !== ""}
      />

      {/* Size % slider */}
      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={sizePercent}
          onChange={(e) => applySizePercent(Number(e.target.value))}
          disabled={freeCollateralMicros <= 0n || noRefPrice}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-bg-muted accent-accent disabled:opacity-40"
        />
        <div className="flex justify-between">
          {[0, 25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applySizePercent(pct)}
              disabled={freeCollateralMicros <= 0n || noRefPrice}
              className="text-[10px] font-medium text-fg-subtle active:text-accent disabled:opacity-40"
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Reduce-only */}
      <label className="flex items-center justify-between text-xs">
        <span className="text-fg-muted">Reduce only</span>
        <button
          type="button"
          role="switch"
          aria-checked={reduceOnly}
          onClick={() => setReduceOnly((v) => !v)}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            reduceOnly ? "bg-accent" : "bg-bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-fg transition-transform",
              reduceOnly ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </label>

      {/* Live summary */}
      <div className="flex flex-col gap-1 rounded-md bg-bg-muted px-3 py-2 text-xs">
        <SummaryRow
          label="Order Value"
          value={
            estimate.orderValueMicros > 0n
              ? formatMicrosUsd(estimate.orderValueMicros)
              : "—"
          }
        />
        <SummaryRow
          label="Margin Required"
          value={
            estimate.marginRequiredMicros > 0n
              ? formatMicrosUsd(estimate.marginRequiredMicros)
              : "—"
          }
        />
        <SummaryRow
          label="Est. Liq. Price"
          value={
            estimate.liquidationPriceMicros != null
              ? formatMicrosUsd(estimate.liquidationPriceMicros)
              : "—"
          }
          accent={isLong ? "down" : "up"}
        />
        <SummaryRow
          label="Free Collateral"
          value={
            account.view
              ? `$${account.view.effectiveCollateral.ui}`
              : "—"
          }
        />
      </div>

      {/* Submit */}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className={cn(
          "rounded-md py-3 text-sm font-bold transition-opacity disabled:opacity-40",
          isLong ? "bg-up text-bg" : "bg-down text-bg",
        )}
      >
        {tx.isPending
          ? "Submitting…"
          : `${isLong ? "Buy" : "Sell"} ${symbol} ${
              orderType === "market" ? "Market" : "Limit"
            }`}
      </button>

      {/* Tx feedback */}
      {tx.state.phase !== "idle" && tx.state.message ? (
        <TxFeedback
          phase={tx.state.phase}
          message={tx.state.message}
          signature={tx.state.signature}
          onDismiss={tx.reset}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 rounded-md bg-bg-muted p-0.5", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          onClick={() => {
            if (!opt.disabled) onChange(opt.value);
          }}
          className={cn(
            "flex-1 rounded py-1.5 text-xs font-semibold transition-colors",
            opt.disabled
              ? "cursor-not-allowed text-fg-subtle opacity-40"
              : value === opt.value
                ? "bg-bg-elevated text-fg"
                : "text-fg-muted active:text-fg",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  invalid,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-bg-muted px-3 py-2",
          invalid ? "border-down" : "border-border",
        )}
      >
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent font-mono text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        {suffix}
      </div>
    </div>
  );
}

function SummaryRow({
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
      <span className="text-fg-muted">{label}</span>
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

function TxFeedback({
  phase,
  message,
  signature,
  onDismiss,
}: {
  phase: "pending" | "success" | "error";
  message: string;
  signature: string | null;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs",
        phase === "pending" && "border-border bg-bg-muted text-fg-muted",
        phase === "success" && "border-up/40 bg-up-bg text-up",
        phase === "error" && "border-down/40 bg-down-bg text-down",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span>{message}</span>
        {signature ? (
          <a
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] underline opacity-80"
          >
            {signature.slice(0, 8)}…{signature.slice(-8)}
          </a>
        ) : null}
      </div>
      {phase !== "pending" ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 opacity-70"
          aria-label="Dismiss"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

function OrderEntrySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-8 animate-pulse rounded-md bg-bg-muted" />
      <div className="h-11 animate-pulse rounded-md bg-bg-muted" />
      <div className="h-9 animate-pulse rounded-md bg-bg-muted" />
      <div className="h-16 animate-pulse rounded-md bg-bg-muted" />
      <div className="h-12 animate-pulse rounded-md bg-bg-muted" />
    </div>
  );
}
