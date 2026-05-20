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
    return createPhoenixClient({
      apiUrl,
      // Empty string -> let the SDK fall back to NEXT_PUBLIC_SOLANA_RPC_URL /
      // its own default. Pass undefined rather than "" so the SDK fallback
      // logic kicks in.
      rpcUrl: SOLANA_RPC_URL || undefined,
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
