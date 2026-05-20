"use client";

/**
 * LoginScreen — login / splash (PLAN.md §7 screen 1).
 *
 * Offers every available way to connect:
 *   - Privy social login (creates/uses an embedded Solana wallet) — shown when
 *     `PRIVY_ENABLED` (a `NEXT_PUBLIC_PRIVY_APP_ID` is configured).
 *   - Each browser-injected Solana wallet (Phantom, Solflare, Backpack, …),
 *     discovered via the Wallet Standard and listed individually so the user
 *     picks which one to connect.
 *
 * Both paths authenticate to the Phoenix API via the same wallet-signature
 * flow. Once a Rise session exists, calls `onAuthenticated` if provided,
 * otherwise routes to `/onboarding` (which itself short-circuits to the trade
 * screen when the user is already activated + registered).
 *
 * OWNED BY: Auth & Wallet agent (`src/auth/`).
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/wallet/WalletProvider";
import { PRIVY_ENABLED } from "@/lib/constants";

export interface LoginScreenProps {
  /** Called once a Rise session exists. Defaults to routing to `/onboarding`. */
  onAuthenticated?: () => void;
}

/** Turn an unknown thrown value into a user-facing message. */
function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong. Please try again.";
}

/** Sentinel for the Privy method in the per-button pending state. */
const PRIVY_METHOD = "__privy__";

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const router = useRouter();
  const { wallet, isConnecting, connectPrivy, connectExternal, externalWallets } =
    useWallet();
  const [error, setError] = useState<string | null>(null);
  // Which connect method is in flight — so only that button shows "Connecting…".
  const [pending, setPending] = useState<string | null>(null);

  const finish = useCallback(() => {
    if (onAuthenticated) onAuthenticated();
    else router.replace("/onboarding");
  }, [onAuthenticated, router]);

  const handlePrivy = useCallback(async () => {
    setError(null);
    setPending(PRIVY_METHOD);
    try {
      await connectPrivy();
      finish();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setPending(null);
    }
  }, [connectPrivy, finish]);

  const handleExternal = useCallback(
    async (walletName: string) => {
      setError(null);
      setPending(walletName);
      try {
        await connectExternal(walletName);
        finish();
      } catch (e) {
        setError(toMessage(e));
      } finally {
        setPending(null);
      }
    },
    [connectExternal, finish],
  );

  // A session may already exist (e.g. the SDK restored it from localStorage).
  const alreadyConnected = wallet?.isConnected ?? false;

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col px-6 pb-10 pt-16">
      {/* Brand / hero */}
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/phoenix-logo.svg" alt="Phoenix" className="h-9 w-auto" />
        <p className="max-w-[16rem] text-sm leading-snug text-fg-muted">
          Trade perpetual futures on Solana — fast, mobile-first.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-down/40 bg-down-bg px-3 py-2 text-xs leading-snug text-down"
          >
            {error}
          </div>
        ) : null}

        {alreadyConnected ? (
          <button
            type="button"
            onClick={() => finish()}
            className="w-full rounded-md bg-accent py-4 text-sm font-semibold text-accent-fg active:opacity-80"
          >
            Continue
          </button>
        ) : (
          <>
            {/* Privy social login */}
            {PRIVY_ENABLED ? (
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => void handlePrivy()}
                className="w-full rounded-md bg-accent py-4 text-sm font-semibold text-accent-fg shadow-glow active:opacity-80 disabled:opacity-40"
              >
                {pending === PRIVY_METHOD
                  ? "Connecting…"
                  : "Continue with social login"}
              </button>
            ) : null}

            {/* Divider between Privy and the wallet list */}
            {PRIVY_ENABLED && externalWallets.length > 0 ? (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  or connect a wallet
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            {/* External wallet picker — one button per detected wallet. */}
            {externalWallets.map((w) => (
              <button
                key={w.name}
                type="button"
                disabled={isConnecting}
                onClick={() => void handleExternal(w.name)}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-bg-elevated px-4 py-3.5 text-sm font-medium text-fg active:bg-bg-muted disabled:opacity-40"
              >
                {w.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={w.icon}
                    alt=""
                    className="h-6 w-6 rounded"
                    aria-hidden
                  />
                ) : (
                  <span className="h-6 w-6 rounded bg-bg-muted" aria-hidden />
                )}
                <span>{w.name}</span>
                <span className="ml-auto text-xs text-fg-subtle">
                  {pending === w.name ? "Connecting…" : "Connect"}
                </span>
              </button>
            ))}

            {/* No injected wallet found. */}
            {externalWallets.length === 0 ? (
              <div className="rounded-md border border-border bg-bg-elevated px-4 py-3 text-xs leading-snug text-fg-muted">
                No Solana wallet detected. Install{" "}
                <span className="text-fg">Phantom</span>,{" "}
                <span className="text-fg">Solflare</span>, or{" "}
                <span className="text-fg">Backpack</span>
                {PRIVY_ENABLED
                  ? " — or use social login above."
                  : " to continue."}
              </div>
            ) : null}
          </>
        )}

        <p className="px-2 text-center text-[11px] leading-snug text-fg-subtle">
          {PRIVY_ENABLED
            ? "Social login creates a secure embedded wallet. You can also connect an existing Solana wallet."
            : "Connect a Solana wallet (Phantom, Solflare, Backpack) to start trading."}
        </p>
      </div>
    </main>
  );
}
