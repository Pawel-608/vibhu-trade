"use client";

/**
 * OnboardingFlow — invite activation -> trader registration (PLAN.md §7 #2).
 *
 * Phoenix perps is invite-gated (API-RECON.md §5: exchange is `gated`). The
 * flow has two steps:
 *
 *   Step 1 — Invite activation.
 *     `client.api.invite().checkWallet(authority)` reports whether the wallet is
 *     whitelisted. If not, the user enters an access code or referral code and
 *     we call `activateInvite` / `activateInviteWithReferral`.
 *
 *   Step 2 — Trader registration.
 *     `client.ixs.buildRegisterTrader({ authority, marginType: Cross })` builds
 *     the register-trader instruction; we sign + submit it via the Trading
 *     agent's `submitTransaction`. An "already exists" error from the builder
 *     means the trader is already registered — treated as success.
 *
 * Both steps detect and short-circuit the already-done state so a returning
 * user lands straight on the trade screen.
 *
 * OWNED BY: Auth & Wallet agent (`src/auth/`).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MarginType } from "@ellipsis-labs/rise";
import type { Authority } from "@ellipsis-labs/rise";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { submitTransaction } from "@/trading/submitTransaction";
import { tradeRoute } from "@/lib/constants";

/**
 * Referral code applied to new-account invite activation, so accounts created
 * through this app are credited to our referral. Overridable via env.
 */
const PHOENIX_REFERRAL_CODE =
  process.env.NEXT_PUBLIC_PHOENIX_REFERRAL_CODE ?? "GZNNNBK5";

export interface OnboardingFlowProps {
  /** Called once the trader is registered & ready. Defaults to routing to the trade screen. */
  onComplete?: () => void;
}

/** Onboarding phases. */
type Phase =
  | "checking" // probing invite + registration status
  | "needs-invite" // wallet not whitelisted -> show code form
  | "needs-registration" // whitelisted but trader not registered
  | "activating" // invite activation in flight
  | "registering" // trader registration tx in flight
  | "done" // fully onboarded
  | "no-wallet"; // no connected wallet — cannot proceed

/** Which invite-code path the user picked. */
type CodeMode = "access" | "referral";

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong. Please try again.";
}

/** True when an error indicates the trader account already exists. */
function isAlreadyRegistered(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /already exist/i.test(msg);
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const router = useRouter();
  const client = usePhoenixClient();
  const { wallet } = useWallet();

  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  // Default to the referral path, pre-filled with our referral code, so a new
  // user just taps "Activate invite" and the account is credited to us.
  const [codeMode, setCodeMode] = useState<CodeMode>("referral");
  const [code, setCode] = useState(PHOENIX_REFERRAL_CODE);

  const finish = useCallback(() => {
    if (onComplete) onComplete();
    else router.replace(tradeRoute());
  }, [onComplete, router]);

  /* ----------------------------------------------------------------------- */
  /* Step 2 — trader registration                                            */
  /* ----------------------------------------------------------------------- */

  const registerTrader = useCallback(async (): Promise<boolean> => {
    if (!wallet) return false;
    try {
      // Build the register-trader instruction (cross margin — the default
      // account; isolated subaccounts are created later, per-position).
      const registerIx = await client.ixs.buildRegisterTrader({
        authority: wallet.authority as Authority,
        marginType: MarginType.Cross,
      });

      // Sign + submit. The Trading agent's `submitTransaction` owns the full
      // assemble -> sign -> submit -> confirm pipeline (PLAN.md §3); it takes
      // the raw Rise SDK instruction(s).
      await submitTransaction({
        client,
        wallet,
        instructions: registerIx,
      });
      return true;
    } catch (e) {
      // The builder throws when the trader account already exists — that is a
      // success for onboarding purposes.
      if (isAlreadyRegistered(e)) return true;
      throw e;
    }
  }, [client, wallet]);

  /* ----------------------------------------------------------------------- */
  /* Initial status probe                                                    */
  /* ----------------------------------------------------------------------- */

  const probeStatus = useCallback(async () => {
    if (!wallet?.isConnected) {
      setPhase("no-wallet");
      return;
    }
    setError(null);
    setPhase("checking");
    try {
      const status = await client.api.invite().checkWallet(wallet.authority);
      if (!status.whitelisted) {
        setPhase("needs-invite");
        return;
      }
      // Whitelisted — move to (or past) registration.
      setPhase("needs-registration");
    } catch (e) {
      setError(toMessage(e));
      setPhase("needs-invite");
    }
  }, [client, wallet]);

  useEffect(() => {
    void probeStatus();
  }, [probeStatus]);

  /* ----------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ----------------------------------------------------------------------- */

  const handleActivate = useCallback(async () => {
    if (!wallet || !code.trim()) return;
    setError(null);
    setPhase("activating");
    try {
      const invite = client.api.invite();
      if (codeMode === "referral") {
        await invite.activateInviteWithReferral({
          authority: wallet.authority,
          referral_code: code.trim(),
        });
      } else {
        await invite.activateInvite({
          authority: wallet.authority,
          code: code.trim(),
        });
      }
      // Activation succeeded — proceed to registration.
      setPhase("needs-registration");
    } catch (e) {
      setError(toMessage(e));
      setPhase("needs-invite");
    }
  }, [client, wallet, code, codeMode]);

  const handleRegister = useCallback(async () => {
    setError(null);
    setPhase("registering");
    try {
      const ok = await registerTrader();
      if (ok) {
        setPhase("done");
      } else {
        setError("Could not register your trader account.");
        setPhase("needs-registration");
      }
    } catch (e) {
      setError(toMessage(e));
      setPhase("needs-registration");
    }
  }, [registerTrader]);

  // Auto-advance to the trade screen once fully onboarded.
  useEffect(() => {
    if (phase === "done") finish();
  }, [phase, finish]);

  /* ----------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ----------------------------------------------------------------------- */

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col gap-5 px-6 pb-10 pt-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">Get started</h1>
        <p className="text-sm text-fg-muted">
          {phase === "needs-invite"
            ? "Phoenix is invite-only. Enter your code to continue."
            : "Set up your Phoenix trading account."}
        </p>
      </header>

      {/* Step indicator */}
      <ol className="flex items-center gap-2 text-[11px] font-medium">
        <StepDot
          n={1}
          label="Invite"
          active={
            phase === "needs-invite" || phase === "activating"
          }
          done={
            phase === "needs-registration" ||
            phase === "registering" ||
            phase === "done"
          }
        />
        <span className="h-px flex-1 bg-border" />
        <StepDot
          n={2}
          label="Register"
          active={phase === "needs-registration" || phase === "registering"}
          done={phase === "done"}
        />
      </ol>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-down/40 bg-down-bg px-3 py-2 text-xs leading-snug text-down"
        >
          {error}
        </div>
      ) : null}

      {/* Body */}
      <div className="flex flex-1 flex-col">
        {phase === "no-wallet" ? (
          <Centered>
            <p className="text-sm text-fg-muted">
              Connect a wallet first to continue onboarding.
            </p>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="rounded-md bg-accent px-5 py-3 text-sm font-semibold text-accent-fg active:opacity-80"
            >
              Go to login
            </button>
          </Centered>
        ) : null}

        {phase === "checking" ? (
          <Centered>
            <Spinner />
            <p className="text-sm text-fg-muted">Checking your access…</p>
          </Centered>
        ) : null}

        {phase === "needs-invite" || phase === "activating" ? (
          <div className="flex flex-col gap-3">
            {/* Code-type toggle */}
            <div className="flex gap-1 rounded-md bg-bg-muted p-0.5 text-xs font-medium">
              <ToggleButton
                active={codeMode === "access"}
                onClick={() => {
                  setCodeMode("access");
                  setCode("");
                }}
              >
                Access code
              </ToggleButton>
              <ToggleButton
                active={codeMode === "referral"}
                onClick={() => {
                  setCodeMode("referral");
                  setCode(PHOENIX_REFERRAL_CODE);
                }}
              >
                Referral code
              </ToggleButton>
            </div>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={
                codeMode === "referral"
                  ? "Enter referral code"
                  : "Enter access code"
              }
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-bg-muted px-4 py-3.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />

            <button
              type="button"
              disabled={phase === "activating" || !code.trim()}
              onClick={() => void handleActivate()}
              className="w-full rounded-md bg-accent py-4 text-sm font-semibold text-accent-fg active:opacity-80 disabled:opacity-40"
            >
              {phase === "activating" ? "Activating…" : "Activate invite"}
            </button>
          </div>
        ) : null}

        {phase === "needs-registration" || phase === "registering" ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-bg-elevated p-4">
              <p className="text-sm font-medium text-fg">
                Register your trader account
              </p>
              <p className="mt-1 text-xs leading-snug text-fg-muted">
                This is a one-time on-chain setup. You will be asked to approve
                a transaction.
              </p>
            </div>
            <button
              type="button"
              disabled={phase === "registering"}
              onClick={() => void handleRegister()}
              className="w-full rounded-md bg-accent py-4 text-sm font-semibold text-accent-fg active:opacity-80 disabled:opacity-40"
            >
              {phase === "registering"
                ? "Registering…"
                : "Register & start trading"}
            </button>
          </div>
        ) : null}

        {phase === "done" ? (
          <Centered>
            <Spinner />
            <p className="text-sm text-fg-muted">Taking you to the markets…</p>
          </Centered>
        ) : null}
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Small presentational helpers                                               */
/* -------------------------------------------------------------------------- */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent"
      aria-hidden
    />
  );
}

function StepDot({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className={
          done
            ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg"
            : active
              ? "flex h-5 w-5 items-center justify-center rounded-full border border-accent text-accent"
              : "flex h-5 w-5 items-center justify-center rounded-full border border-border text-fg-subtle"
        }
      >
        {done ? "✓" : n}
      </span>
      <span className={done || active ? "text-fg" : "text-fg-subtle"}>
        {label}
      </span>
    </li>
  );
}

function ToggleButton({
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
      className={
        active
          ? "flex-1 rounded bg-bg-elevated py-1.5 text-fg"
          : "flex-1 rounded py-1.5 text-fg-muted active:text-fg"
      }
    >
      {children}
    </button>
  );
}
