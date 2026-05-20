"use client";

/**
 * AccountGate — graceful prompts for the not-connected / not-registered states.
 *
 * Trading is invite-gated and needs a registered Phoenix trader account. The
 * actual onboarding flow (login, invite activation, trader registration) is
 * owned by the Auth & Wallet agent in `src/auth/` — this component does NOT
 * build it; it only surfaces a clear message and routes the user toward it.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface AccountGatePromptProps {
  title: string;
  detail: string;
  /** Optional action button. */
  action?: { label: string; onClick: () => void };
  className?: string;
  children?: ReactNode;
}

export function AccountGatePrompt({
  title,
  detail,
  action,
  className,
  children,
}: AccountGatePromptProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated p-6 text-center",
        className,
      )}
    >
      <span className="text-sm font-semibold text-fg">{title}</span>
      <p className="max-w-xs text-xs leading-snug text-fg-muted">{detail}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-bg active:opacity-80"
        >
          {action.label}
        </button>
      ) : null}
      {children}
    </div>
  );
}

/** A compact inline error row. */
export function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-down/40 bg-down-bg px-3 py-2 text-xs text-down">
      {message}
    </div>
  );
}
