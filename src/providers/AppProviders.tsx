"use client";

/**
 * Composes every app-wide provider in one place. Mounted once by the root
 * layout (`app/layout.tsx`).
 *
 * Order matters:
 *   PrivyAuthProvider  — outermost: auth must be available to everything.
 *   QueryProvider      — HTTP cache for one-shot reads.
 *   RiseClientProvider — the Phoenix SDK client (depends on env, not on Privy).
 *   WalletProvider     — wallet abstraction; consumes Privy + the Rise client.
 *
 * SHARED — feature agents must not edit this file.
 */

import type { ReactNode } from "react";
import { PrivyAuthProvider } from "./PrivyAuthProvider";
import { QueryProvider } from "./QueryProvider";
import { RiseClientProvider } from "./RiseClientProvider";
import { WalletProvider } from "@/wallet/WalletProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyAuthProvider>
      <QueryProvider>
        <RiseClientProvider>
          <WalletProvider>{children}</WalletProvider>
        </RiseClientProvider>
      </QueryProvider>
    </PrivyAuthProvider>
  );
}
