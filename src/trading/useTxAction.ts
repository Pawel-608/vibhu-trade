"use client";

/**
 * useTxAction — wraps a transaction-submitting async action with optimistic
 * pending / success / error feedback for the mobile UI (PLAN.md §7).
 *
 * Keeps tx status local to the calling component — there is no app-wide toast
 * provider in the shared layer, so trading surfaces its own inline feedback.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import { useCallback, useRef, useState } from "react";
import type { TxResult } from "@/types";

export type TxPhase = "idle" | "pending" | "success" | "error";

export interface TxState {
  phase: TxPhase;
  /** Signature once submitted (success or confirmation-timeout). */
  signature: string | null;
  /** Human-readable message for the current phase. */
  message: string | null;
}

const IDLE: TxState = { phase: "idle", signature: null, message: null };

export interface UseTxActionResult {
  state: TxState;
  /** True while a transaction is in flight. */
  isPending: boolean;
  /** Run `action`; updates `state` through pending → success/error. */
  run: (
    action: () => Promise<TxResult>,
    labels?: { pending?: string; success?: string },
  ) => Promise<TxResult | null>;
  /** Reset back to idle. */
  reset: () => void;
}

export function useTxAction(): UseTxActionResult {
  const [state, setState] = useState<TxState>(IDLE);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState(IDLE);
  }, []);

  const run = useCallback<UseTxActionResult["run"]>(async (action, labels) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState({
      phase: "pending",
      signature: null,
      message: labels?.pending ?? "Submitting transaction…",
    });
    try {
      const result = await action();
      setState({
        phase: result.confirmed ? "success" : "error",
        signature: result.signature,
        message: result.confirmed
          ? (labels?.success ?? "Transaction confirmed.")
          : "Submitted, but not confirmed in time.",
      });
      // Auto-clear a success after a short delay.
      if (result.confirmed) {
        resetTimer.current = setTimeout(() => setState(IDLE), 4_000);
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Transaction failed.";
      const signature =
        error && typeof error === "object" && "signature" in error
          ? ((error as { signature?: string }).signature ?? null)
          : null;
      setState({ phase: "error", signature, message });
      return null;
    }
  }, []);

  return { state, isPending: state.phase === "pending", run, reset };
}
