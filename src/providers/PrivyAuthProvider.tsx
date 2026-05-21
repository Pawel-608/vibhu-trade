"use client";

/**
 * Privy auth + embedded-wallet provider.
 *
 * Wraps `@privy-io/react-auth`'s `PrivyProvider`, configured for Solana
 * (PLAN.md §4). Using Phoenix's Privy app ID is what makes "same login ->
 * same embedded wallet -> same Phoenix account" work; without an app ID we
 * still render children so the external-wallet fallback path stays usable.
 *
 * SHARED PROVIDER — feature agents must not edit this file. The Auth & Wallet
 * agent consumes Privy via `src/wallet/` (useWallet), not by editing this.
 */

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID, PRIVY_ENABLED, SOLANA_RPC_URL } from "@/lib/constants";

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  // No app ID configured -> skip Privy entirely. The app still runs on the
  // external-wallet path (PLAN.md §4 "Sequencing"). This also keeps local dev
  // and CI green without secrets.
  if (!PRIVY_ENABLED) {
    return <>{children}</>;
  }

  // Privy REQUIRES a cluster config for solana:mainnet — without one it throws
  // "No RPC configuration found for chain solana:mainnet" and crashes the app.
  // Prefer NEXT_PUBLIC_SOLANA_RPC_URL; otherwise route through the same-origin
  // /api/rpc proxy (forwards to Solana Vibe Station, api_key stays server-side).
  const solanaRpcUrl =
    SOLANA_RPC_URL ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/api/rpc`
      : null);

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#ffa548",
          // Solana-only wallet UI (PLAN.md §4 — Phoenix perps is on Solana).
          walletChainType: "solana-only",
        },
        // Auto-create an embedded Solana wallet for users without one.
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
        // Solana RPC for embedded-wallet operations — see `solanaRpcUrl`
        // above. Always present on the client so Privy never crashes.
        ...(solanaRpcUrl
          ? {
              solanaClusters: [
                { name: "mainnet-beta" as const, rpcUrl: solanaRpcUrl },
              ],
            }
          : {}),
      }}
    >
      {children}
    </PrivyProvider>
  );
}
