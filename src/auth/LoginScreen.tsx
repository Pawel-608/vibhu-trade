"use client";

/**
 * LoginScreen — login / splash (PLAN.md §7 screen 1).
 *
 * Ways in:
 *   - "Sign in" — Privy login (social), which provisions/uses an embedded
 *     Solana wallet.
 *   - "Connect <wallet>" — shown when a Solana wallet is injected into the page
 *     (a desktop extension, or — the mobile path — when the dapp is running
 *     inside Phantom/Solflare's own in-app browser). Connects it directly via
 *     the Wallet Standard, no Privy involved.
 *   - "Open in Solflare / Phantom" — shown on a plain mobile browser (no wallet
 *     injected): deeplinks that reload this dapp inside the wallet app's in-app
 *     browser, where the "Connect" path above then applies.
 *
 * Once a Rise session exists, calls `onAuthenticated` if provided, otherwise
 * routes to `/onboarding`.
 *
 * OWNED BY: Auth & Wallet agent (`src/auth/`).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/wallet/WalletProvider";
import { PRIVY_ENABLED } from "@/lib/constants";
import { VibhuLogo } from "@/components/VibhuLogo";

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

/** True for mobile-browser user agents — where the in-app-browser deeplinks
 *  are the way to reach an existing Phantom/Solflare wallet. */
function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports a desktop Mac UA — detect it via touch points.
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod/i.test(ua) || iPadOs;
}

/**
 * "Open in <wallet>" deeplinks. Each reloads this dapp inside the wallet app's
 * in-app browser, where the wallet is injected and connectable. `url` is the
 * page to open; `ref` identifies the requesting app — both URL-encoded.
 */
function walletBrowserLinks(): { solflare: string; phantom: string } | null {
  if (typeof window === "undefined") return null;
  const url = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);
  return {
    solflare: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`,
    phantom: `https://phantom.app/ul/browse/${url}?ref=${ref}`,
  };
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const router = useRouter();
  const { wallet, isConnecting, connectPrivy, connectExternal, externalWallets } =
    useWallet();
  const [error, setError] = useState<string | null>(null);
  // Which connect method is in flight — so only that button shows "Connecting…".
  const [pending, setPending] = useState<string | null>(null);
  // Mobile detection runs post-mount to avoid an SSR/client hydration mismatch.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => setIsMobile(isMobileBrowser()), []);

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
  // A wallet is injected -> we're in its in-app browser (or a desktop with the
  // extension). Otherwise, on mobile, offer the deeplinks into a wallet app.
  const hasInjectedWallet = externalWallets.length > 0;
  // Inside a wallet's own in-app browser (mobile + injected wallet) social
  // login is pointless. On desktop it stays, even with an extension present.
  const inWalletBrowser = isMobile && hasInjectedWallet;
  const walletLinks =
    isMobile && !hasInjectedWallet ? walletBrowserLinks() : null;

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
        ) : PRIVY_ENABLED ? (
          <>
            {/* Social login: hidden only inside a wallet's in-app browser,
                where offering a fresh embedded wallet makes no sense. Shown
                on desktop even when an extension is present. */}
            {!inWalletBrowser ? (
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => void handlePrivy()}
                className="w-full rounded-md bg-accent py-4 text-sm font-semibold text-accent-fg shadow-glow active:opacity-80 disabled:opacity-40"
              >
                {pending === PRIVY_METHOD
                  ? "Connecting…"
                  : "Sign in with Privy"}
              </button>
            ) : null}

            {/* Injected wallet(s) — connect directly via the Wallet Standard. */}
            {hasInjectedWallet ? (
              <>
                {!inWalletBrowser ? (
                  <Divider label="or connect your wallet" />
                ) : null}
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
                    ) : null}
                    <span>Connect {w.name}</span>
                    <span className="ml-auto text-xs text-fg-subtle">
                      {pending === w.name ? "Connecting…" : "Connect"}
                    </span>
                  </button>
                ))}
              </>
            ) : walletLinks ? (
              /* Plain mobile browser — deeplink into a wallet's in-app browser. */
              <>
                <Divider label="or open in a wallet app" />
                <a
                  href={walletLinks.solflare}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-bg-elevated px-4 py-3.5 text-sm font-medium text-fg active:bg-bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/wallet-solflare.svg"
                    alt=""
                    className="h-6 w-6 rounded"
                    aria-hidden
                  />
                  <span>Open in Solflare</span>
                  <span className="ml-auto text-xs text-fg-subtle">↗</span>
                </a>
                <a
                  href={walletLinks.phantom}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-bg-elevated px-4 py-3.5 text-sm font-medium text-fg active:bg-bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/wallet-phantom.svg"
                    alt=""
                    className="h-6 w-6"
                    aria-hidden
                  />
                  <span>Open in Phantom</span>
                  <span className="ml-auto text-xs text-fg-subtle">↗</span>
                </a>
              </>
            ) : null}
          </>
        ) : (
          <div
            role="alert"
            className="rounded-md border border-down/40 bg-down-bg px-3 py-2 text-xs leading-snug text-down"
          >
            Login is unavailable — set `NEXT_PUBLIC_PRIVY_APP_ID` to enable it.
          </div>
        )}

        <p className="px-2 text-center text-[11px] leading-snug text-fg-subtle">
          {inWalletBrowser
            ? "Connect your wallet to start trading on Vibhu."
            : "Privy sign-in creates a secure embedded Solana wallet — no browser extension or seed phrase needed."}
        </p>
      </div>
    </main>
  );
}

/** A labelled "or" divider between connect options. */
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
