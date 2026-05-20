"use client";

/**
 * CollateralActions — deposit / withdraw collateral.
 *
 * CONTRACT
 *  Props:
 *    - onChanged?: () => void  — called after a successful deposit/withdraw so
 *      the parent can refresh the account snapshot. Optional & additive.
 *  Behaviour (PLAN.md §6): a deposit and a withdraw flow — amount entry,
 *  validation, confirm, pending/success/fail feedback. Mobile-first.
 *  Rise SDK: builds instructions via `client.ixs.buildDepositFunds` /
 *  `buildWithdrawFunds`, then submits with `submitTransaction` from
 *  `@/trading/submitTransaction` (sanctioned cross-import — CONTRACTS §4).
 *  Collateral deposit/withdraw is client-signed; the API only builds ixs.
 *  Wallet: `useWallet()` for `authority` + signing.
 *
 * OWNED BY: Account agent (`src/account/`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { submitTransaction } from "@/trading/submitTransaction";
import { cn } from "@/lib/cn";
import type { Authority } from "@ellipsis-labs/rise";
import {
  COLLATERAL_DECIMALS,
  isAmountInputValid,
  parseAmountToBigint,
} from "./lib";
import { DEFAULT_PDA_INDEX } from "./useTraderState";

type CollateralMode = "deposit" | "withdraw";

type TxPhase =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; signature: string; confirmed: boolean }
  | { kind: "error"; message: string };

export interface CollateralActionsProps {
  /** Called after a successful deposit/withdraw — lets the parent refresh. */
  onChanged?: () => void;
}

export function CollateralActions({ onChanged }: CollateralActionsProps) {
  const client = usePhoenixClient();
  const { wallet } = useWallet();
  const router = useRouter();
  const connected = !!wallet?.isConnected && !!wallet.authority;

  const [mode, setMode] = useState<CollateralMode>("deposit");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<TxPhase>({ kind: "idle" });

  const parsedAmount = parseAmountToBigint(amount);
  const amountSyntaxOk = isAmountInputValid(amount);
  const amountTouched = amount.trim().length > 0;
  const amountValid = parsedAmount !== null;
  const busy = phase.kind === "pending";

  function handleAmountChange(next: string) {
    // Keep only well-formed numeric input; reject stray characters early.
    if (next === "" || isAmountInputValid(next)) {
      setAmount(next);
      if (phase.kind !== "idle") setPhase({ kind: "idle" });
    }
  }

  function switchMode(next: CollateralMode) {
    if (next === mode) return;
    setMode(next);
    setAmount("");
    setPhase({ kind: "idle" });
  }

  async function handleSubmit() {
    if (!connected || !wallet || parsedAmount === null || busy) return;
    setPhase({ kind: "pending" });

    try {
      const authority = wallet.authority as Authority;
      // 1. Build the FULL collateral instruction set — NOT the bare
      //    deposit/withdraw instruction. Phoenix needs the trader's canonical
      //    (PhUSD) token account created and the Ember leg included; the bare
      //    instruction on its own fails preflight with "invalid account data"
      //    because that token account does not exist yet. `buildDepositIxs`
      //    returns [createPhoenixAta, emberDeposit, depositFunds];
      //    `buildWithdrawIxs` returns the matching create-ATA / approve /
      //    withdraw / ember set.
      const flow =
        mode === "deposit"
          ? await client.ixs.buildDepositIxs({
              authority,
              amount: parsedAmount,
              traderPdaIndex: DEFAULT_PDA_INDEX,
            })
          : await client.ixs.buildWithdrawIxs({
              authority,
              amount: parsedAmount,
              traderPdaIndex: DEFAULT_PDA_INDEX,
            });

      // 2. Submit the whole instruction set via the shared pipeline
      //    (assemble -> sign with the wallet -> submit -> confirm).
      const result = await submitTransaction({
        client,
        wallet,
        instructions: flow.instructions,
      });

      setPhase({
        kind: "success",
        signature: result.signature,
        confirmed: result.confirmed,
      });
      setAmount("");
      onChanged?.();
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Transaction failed. Please try again.",
      });
    }
  }

  const actionLabel = mode === "deposit" ? "Deposit" : "Withdraw";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Collateral
      </h2>

      <div className="flex flex-col gap-3 rounded-lg bg-bg-elevated p-4">
        {/* Deposit / Withdraw toggle. */}
        <div
          role="tablist"
          aria-label="Collateral action"
          className="grid grid-cols-2 gap-1 rounded-md bg-bg-muted p-0.5"
        >
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={busy}
              onClick={() => switchMode(m)}
              className={cn(
                "rounded py-1.5 text-xs font-semibold capitalize transition-colors",
                mode === m
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted active:text-fg",
                busy && "opacity-60",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Amount input. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="collateral-amount"
            className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle"
          >
            Amount (USDC)
          </label>
          <div
            className={cn(
              "flex items-center rounded-md border bg-bg-muted px-3",
              amountTouched && !amountValid
                ? "border-down/60"
                : "border-border",
            )}
          >
            <input
              id="collateral-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              disabled={busy || !connected}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="h-12 flex-1 bg-transparent font-mono text-lg tabular-nums text-fg outline-none placeholder:text-fg-subtle disabled:opacity-60"
            />
            <span className="font-mono text-sm font-medium text-fg-muted">
              USDC
            </span>
          </div>
          {amountTouched && !amountValid ? (
            <span className="text-[11px] text-down">
              {amountSyntaxOk
                ? `Enter an amount greater than 0 (max ${COLLATERAL_DECIMALS} decimals).`
                : "Enter a valid number."}
            </span>
          ) : null}
        </div>

        {/* Submit — or a connect-wallet button when no wallet is attached. */}
        {connected ? (
          <button
            type="button"
            disabled={!amountValid || busy}
            onClick={handleSubmit}
            className={cn(
              "flex h-12 items-center justify-center rounded-md text-sm font-semibold transition-opacity",
              mode === "deposit"
                ? "bg-accent text-accent-fg"
                : "border border-border bg-transparent text-fg",
              (!amountValid || busy) && "cursor-not-allowed opacity-40",
            )}
          >
            {busy ? `${actionLabel}ing…` : `${actionLabel} Collateral`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="flex h-12 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-fg transition-opacity active:opacity-80"
          >
            Connect wallet
          </button>
        )}

        {/* Tx feedback. */}
        <TxFeedback phase={phase} />
      </div>
    </section>
  );
}

function TxFeedback({ phase }: { phase: TxPhase }) {
  if (phase.kind === "idle") return null;

  if (phase.kind === "pending") {
    return (
      <p className="text-center text-xs text-fg-muted">
        Building and submitting your transaction…
      </p>
    );
  }

  if (phase.kind === "success") {
    return (
      <div className="rounded-md border border-up/40 bg-up-bg px-3 py-2 text-center">
        <p className="text-xs font-semibold text-up">
          {phase.confirmed
            ? "Transaction confirmed."
            : "Transaction submitted."}
        </p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-fg-subtle">
          {phase.signature}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-down/40 bg-down-bg px-3 py-2 text-center">
      <p className="text-xs font-medium text-down">{phase.message}</p>
    </div>
  );
}
