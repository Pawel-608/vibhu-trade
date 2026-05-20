"use client";

/**
 * Rise SDK client provider.
 *
 * Creates the Phoenix client via `createPhoenixClient` (`@ellipsis-labs/rise`)
 * once per app session and exposes it through React context plus a
 * `usePhoenixClient()` hook. Configures HTTP (`apiUrl`), RPC (`rpcUrl`),
 * websocket streams (`ws`), and shared auth/session handling (`auth: true`
 * with browser localStorage persistence) per PLAN.md §3 / §4.
 *
 * SHARED PROVIDER — feature agents must not edit this file. Consume the client
 * via `usePhoenixClient()`:
 *   - one-shot reads  -> `client.api.*`   (wrap in React Query)
 *   - live data       -> `client.streams.*` / `client.marketData()` (Zustand)
 *   - tx building     -> `client.ixs`, `client.orderPackets`
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  createPhoenixClient,
  LocalStorageAuthSessionStorage,
  type PhoenixClient,
} from "@ellipsis-labs/rise";
import {
  PHOENIX_API_URL,
  PHOENIX_API_PROXY_PATH,
  PHOENIX_WS_URL,
  SOLANA_RPC_URL,
} from "@/lib/constants";

const RiseClientContext = createContext<PhoenixClient | null>(null);

export function RiseClientProvider({ children }: { children: ReactNode }) {
  // The client owns websocket connections and an auth session manager; create
  // it exactly once and dispose it on unmount.
  const client = useMemo<PhoenixClient>(() => {
    // HTTP goes through the same-origin proxy (the Phoenix API rejects the
    // browser CORS preflight for the SDK's custom headers). WS is unaffected
    // and connects directly. On the server `window` is undefined, but no real
    // fetches happen there — components fetch on mount, client-side.
    const apiUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${PHOENIX_API_PROXY_PATH}`
        : PHOENIX_API_URL;
    // The SDK needs a WORKING Solana RPC for on-chain reads — notably
    // `buildRegisterTrader`'s `accountExists()` pre-check, which decides
    // whether the trader is already registered. With no RPC the SDK falls back
    // to a dead default, that check silently fails, and the app builds a
    // doomed `register_trader` tx for an account that already exists. Route
    // RPC through the same-origin `/api/rpc` proxy (server-side `SOLANA_RPC_URL`
    // is the real, working endpoint — it stays out of the browser bundle).
    const rpcUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/rpc`
        : SOLANA_RPC_URL || undefined;
    return createPhoenixClient({
      apiUrl,
      rpcUrl,
      // Enable live WS streams (l2Book, fills, candles, markPrice, ...).
      // Explicit url so it is NOT derived from the proxied apiUrl.
      ws: { url: PHOENIX_WS_URL },
      // Shared auth/session handling — the SDK auto-attaches the bearer token,
      // auto-refreshes, and authenticates WS subscriptions (PLAN.md §4).
      auth: true,
      authConfig: {
        storage:
          typeof window !== "undefined"
            ? new LocalStorageAuthSessionStorage()
            : undefined,
      },
      // Flight builder routing is configured later — see PLAN.md §5 and
      // src/lib/constants.ts (FLIGHT_* placeholders). Left unset until the
      // builder is registered so order instructions are not Flight-wrapped yet.
    });
  }, []);

  useEffect(() => {
    return () => {
      client.dispose();
    };
  }, [client]);

  return (
    <RiseClientContext.Provider value={client}>
      {children}
    </RiseClientContext.Provider>
  );
}

/** Access the shared Rise `PhoenixClient`. Throws if used outside the provider. */
export function usePhoenixClient(): PhoenixClient {
  const client = useContext(RiseClientContext);
  if (!client) {
    throw new Error(
      "usePhoenixClient() must be used within <RiseClientProvider>.",
    );
  }
  return client;
}
