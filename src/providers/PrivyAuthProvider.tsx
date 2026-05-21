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
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { PRIVY_APP_ID, PRIVY_ENABLED } from "@/lib/constants";

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  // No app ID configured -> skip Privy entirely. The app still runs on the
  // external-wallet path (PLAN.md §4 "Sequencing"). This also keeps local dev
  // and CI green without secrets.
  if (!PRIVY_ENABLED) {
    return <>{children}</>;
  }

  // Privy v3's standard-wallet hooks (sign / sign-and-send) REQUIRE an RPC
  // config for `solana:mainnet` under `config.solana.rpcs`. Without it Privy
  // throws "No RPC configuration found for chain solana:mainnet" and crashes
  // the app. Built client-side (needs `window` for the origin); Privy does no
  // Solana RPC during SSR.
  //
  // `rpc` goes through the same-origin /api/rpc proxy -> Solana Vibe Station,
  // so the api_key never reaches the browser. `rpcSubscriptions` targets the
  // same origin; the proxy is HTTP-only, but the embedded wallet here only
  // SIGNS (the Rise SDK submits + confirms), so no WS subscription is opened —
  // `@solana/kit` creates the transport lazily.
  const solanaConfig =
    typeof window !== "undefined"
      ? {
          rpcs: {
            "solana:mainnet": {
              rpc: createSolanaRpc(`${window.location.origin}/api/rpc`),
              rpcSubscriptions: createSolanaRpcSubscriptions(
                `${window.location.origin.replace(/^http/, "ws")}/api/rpc`,
              ),
              blockExplorerUrl: "https://explorer.solana.com",
            },
          },
        }
      : undefined;

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
        // Solana RPC for the embedded wallet's standard hooks — see
        // `solanaConfig` above. Present on the client so Privy never crashes.
        ...(solanaConfig ? { solana: solanaConfig } : {}),
      }}
    >
      {children}
    </PrivyProvider>
  );
}
