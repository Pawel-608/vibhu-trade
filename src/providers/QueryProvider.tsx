"use client";

/**
 * TanStack Query provider — caches one-shot HTTP reads (market list, history,
 * trader snapshots). Live data uses the Rise SDK's Zustand stores directly and
 * does NOT go through React Query (PLAN.md §3 "Data-flow rules").
 *
 * SHARED PROVIDER — feature agents must not edit this file.
 */

import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // One-shot reads: modest staleness, no aggressive refetch on mobile.
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // Create the client once per mounted tree (survives re-renders, fresh per
  // request on the server).
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
