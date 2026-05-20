"use client";

/**
 * LoginScreen — login / splash (PLAN.md §7 screen 1).
 *
 * Offers every available way to connect:
 *   - Privy social login (creates/uses an embedded Solana wallet) — shown when
 *     `PRIVY_ENABLED` (a `NEXT_PUBLIC_PRIVY_APP_ID` is configured).
 *   - A curated set of known Solana wallets (Phantom, Solflare, Backpack) that
 *     is ALWAYS shown: an installed wallet gets a "Connect" action, a missing
 *     one gets an "Install" link. Any other Wallet-Standard wallet the browser
 *     exposes (e.g. Jupiter) is appended automatically.
 *
 * Both connect paths authenticate to the Phoenix API via the same
 * wallet-signature flow. Once a Rise session exists, calls `onAuthenticated`
 * if provided, otherwise routes to `/onboarding` (which itself short-circuits
 * to the trade screen when the user is already activated + registered).
 *
 * OWNED BY: Auth & Wallet agent (`src/auth/`).
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/wallet/WalletProvider";
import { PRIVY_ENABLED } from "@/lib/constants";
import { VibhuLogo } from "@/components/VibhuLogo";

export interface LoginScreenProps {
  /** Called once a Rise session exists. Defaults to routing to `/onboarding`. */
  onAuthenticated?: () => void;
}

/**
 * Curated wallets always offered on the login screen, in display order. When a
 * wallet here is not installed the row becomes a link to its install page;
 * `brand` colours the monogram shown in place of the (absent) wallet icon.
 * `name` MUST match the wallet's Wallet-Standard name so it dedupes against
 * live auto-detection.
 */
const KNOWN_WALLETS: { name: string; url: string; brand: string }[] = [
  { name: "Phantom", url: "https://phantom.app/download", brand: "#534bb1" },
  { name: "Solflare", url: "https://solflare.com/download", brand: "#fc7227" },
  { name: "Backpack", url: "https://backpack.app/download", brand: "#e33e3f" },
];

/** A row in the wallet list — a connectable wallet, or an install link. */
type WalletRow =
  | { kind: "installed"; name: string; icon: string }
  | { kind: "missing"; name: string; url: string; brand: string };

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

  // Merge the curated known-wallet list with live Wallet-Standard detection:
  // known wallets always appear (Connect when installed, Install when not);
  // any other detected wallet (e.g. Jupiter) is appended.
  const walletRows = useMemo<WalletRow[]>(() => {
    const detected = new Map(externalWallets.map((w) => [w.name, w]));
    const rows: WalletRow[] = [];
    for (const known of KNOWN_WALLETS) {
      const hit = detected.get(known.name);
      if (hit) {
        rows.push({ kind: "installed", name: hit.name, icon: hit.icon });
        detected.delete(known.name);
      } else {
        rows.push({ kind: "missing", ...known });
      }
    }
    for (const w of detected.values()) {
      rows.push({ kind: "installed", name: w.name, icon: w.icon });
    }
    return rows;
  }, [externalWallets]);

  // A session may already exist (e.g. the SDK restored it from localStorage).
  const alreadyConnected = wallet?.isConnected ?? false;

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col px-6 pb-10 pt-16">
      {/* Brand / hero */}
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <VibhuLogo size={44} />
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
            {PRIVY_ENABLED ? (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  or connect a wallet
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            {/* Wallet list — curated known wallets + any other detected one. */}
            {walletRows.map((row) =>
              row.kind === "installed" ? (
                <button
                  key={row.name}
                  type="button"
                  disabled={isConnecting}
                  onClick={() => void handleExternal(row.name)}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-bg-elevated px-4 py-3.5 text-sm font-medium text-fg active:bg-bg-muted disabled:opacity-40"
                >
                  {row.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.icon}
                      alt=""
                      className="h-6 w-6 rounded"
                      aria-hidden
                    />
                  ) : (
                    <WalletMonogram name={row.name} brand="#3a2c1f" />
                  )}
                  <span>{row.name}</span>
                  <span className="ml-auto text-xs text-fg-subtle">
                    {pending === row.name ? "Connecting…" : "Connect"}
                  </span>
                </button>
              ) : (
                <a
                  key={row.name}
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-bg-elevated px-4 py-3.5 text-sm font-medium text-fg-muted active:bg-bg-muted"
                >
                  <WalletMonogram name={row.name} brand={row.brand} />
                  <span>{row.name}</span>
                  <span className="ml-auto text-xs text-fg-subtle">
                    Install ↗
                  </span>
                </a>
              ),
            )}
          </>
        )}

        <p className="px-2 text-center text-[11px] leading-snug text-fg-subtle">
          {PRIVY_ENABLED
            ? "Social login creates a secure embedded wallet. You can also connect an existing Solana wallet."
            : "Connect a Solana wallet — or install one — to start trading."}
        </p>
      </div>
    </main>
  );
}

/** Brand-coloured letter tile shown when a wallet has no icon to display. */
function WalletMonogram({ name, brand }: { name: string; brand: string }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold text-white"
      style={{ backgroundColor: brand }}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}
