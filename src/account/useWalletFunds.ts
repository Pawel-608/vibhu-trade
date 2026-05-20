"use client";

/**
 * useWalletFunds — the connected wallet's spendable on-chain balances.
 *
 * The deposit/withdraw flow needs two numbers to pre-validate before it builds
 * a transaction the user cannot actually pay for:
 *   - native SOL (lamports) — every transaction pays a fee, and deposit /
 *     withdraw also create token accounts that need rent;
 *   - USDC — the collateral token, and the hard cap on a deposit.
 *
 * Both are read through the same-origin `/api/rpc` proxy (the RPC key stays
 * server-side). USDC is canonical mainnet USDC (6 decimals).
 *
 * OWNED BY: Account agent (`src/account/`).
 */

import { useQuery } from "@tanstack/react-query";

/** Canonical mainnet USDC mint — the Phoenix perps collateral token. */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Native SOL has 9 decimals (1 SOL = 1e9 lamports). */
export const SOL_DECIMALS = 9;

/**
 * Recommended minimum SOL (in lamports) to comfortably cover a deposit or
 * withdrawal: the network fee plus rent for the token accounts those flows
 * create (~0.002 SOL per account). 0.005 SOL leaves headroom. This drives a
 * non-blocking warning — existing accounts need no fresh rent.
 */
export const MIN_SOL_LAMPORTS = 5_000_000n;

export interface WalletFunds {
  /** Native SOL balance, in lamports. */
  solLamports: bigint;
  /** Wallet USDC balance, raw 6-decimal base units. */
  usdcRaw: bigint;
}

interface TokenAccountsResult {
  value: Array<{
    account: {
      data: { parsed: { info: { tokenAmount: { amount: string } } } };
    };
  }>;
}

/** POST a single JSON-RPC call through the `/api/rpc` proxy. */
async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`Balance lookup failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(json.error.message ?? `RPC error (${method}).`);
  }
  if (json.result === undefined) {
    throw new Error(`RPC returned no result (${method}).`);
  }
  return json.result;
}

async function fetchWalletFunds(authority: string): Promise<WalletFunds> {
  const [sol, tokens] = await Promise.all([
    rpcCall<{ value: number }>("getBalance", [authority]),
    rpcCall<TokenAccountsResult>("getTokenAccountsByOwner", [
      authority,
      { mint: USDC_MINT },
      { encoding: "jsonParsed" },
    ]),
  ]);

  const solLamports = BigInt(sol.value ?? 0);
  // Sum every USDC token account the owner holds (normally just the ATA).
  const usdcRaw = (tokens.value ?? []).reduce((sum, acc) => {
    const amount = acc.account?.data?.parsed?.info?.tokenAmount?.amount;
    return sum + (amount ? BigInt(amount) : 0n);
  }, 0n);

  return { solLamports, usdcRaw };
}

/** Live wallet SOL + USDC balances; refreshes every 30s. */
export function useWalletFunds(authority: string | undefined) {
  return useQuery<WalletFunds>({
    queryKey: ["wallet-funds", authority],
    queryFn: () => fetchWalletFunds(authority as string),
    enabled: !!authority,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
