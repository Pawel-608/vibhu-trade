/**
 * Wallet abstraction — types.
 *
 * A single wallet-agnostic interface so the rest of the app never branches on
 * "Privy vs external wallet" (PLAN.md §4). Two implementations satisfy it, and
 * BOTH authenticate the same way — the wallet-signature flow (`getWalletNonce`
 * -> sign message -> `loginWithWalletSignature`). The only difference is which
 * wallet signs:
 *   1. Privy embedded wallet — social login -> embedded Solana wallet ->
 *      embedded wallet signs the Phoenix nonce.
 *   2. External wallet — Wallet Standard wallet signs the Phoenix nonce.
 *
 * `loginWithPrivyToken` is NOT used: this app runs its own Privy app, and that
 * endpoint only accepts tokens minted by phoenix.trade's own Privy app.
 *
 * OWNED BY: Auth & Wallet agent (`src/wallet/`, `src/auth/`).
 */

import type { AuthSession } from "@ellipsis-labs/rise";
import type { Transaction } from "@solana/kit";

/**
 * A transaction ready to be signed.
 *
 * Concretely this is a `@solana/kit` v4 `Transaction` — a compiled message
 * (`messageBytes`) plus a `signatures` map. The Trading agent's
 * `submitTransaction` builds instructions, compiles a transaction message and
 * produces this value before handing it to `AppWallet.signTransaction`.
 */
export type UnsignedTransaction = Transaction;

/** A signed transaction (kit `Transaction` with its `signatures` map filled). */
export type SignedTransaction = Transaction;

/** Which concrete wallet backs the current session. */
export type WalletKind = "privy-embedded" | "external" | "none";

/**
 * The app's wallet contract (PLAN.md §4).
 *
 * Every screen that needs to sign or authenticate depends only on this.
 */
export interface AppWallet {
  /** Which implementation is active. */
  kind: WalletKind;

  /** Solana pubkey (base58) that authorises trades. */
  authority: string;

  /** Whether a wallet is currently connected/available. */
  isConnected: boolean;

  /** Sign a transaction with the active wallet. */
  signTransaction(tx: UnsignedTransaction): Promise<SignedTransaction>;

  /**
   * Mint a Rise auth session for this wallet. Both wallet kinds use the
   * wallet-signature flow: `auth.getWalletNonce()` -> the wallet signs the
   * returned nonce message -> `auth.loginWithWalletSignature()`.
   * The SDK persists the session; callers usually just await this once.
   */
  loginToRise(): Promise<AuthSession>;
}

/**
 * A browser-injected Solana wallet discovered via the Wallet Standard
 * (Phantom, Solflare, Backpack, …) and offered to the user as a connect option.
 */
export interface ExternalWalletOption {
  /** Wallet Standard display name, e.g. "Phantom", "Solflare", "Backpack". */
  name: string;
  /** Wallet icon — a data-URI string supplied by the wallet. */
  icon: string;
}

/** Value exposed by the `useWallet()` hook. */
export interface WalletContextValue {
  /** The active wallet, or `null` when nothing is connected. */
  wallet: AppWallet | null;

  /** True while a connect / login operation is in flight. */
  isConnecting: boolean;

  /** Begin the Privy embedded-wallet login flow. */
  connectPrivy(): Promise<void>;

  /**
   * Connect an external Solana wallet. Pass a `name` from `externalWallets` to
   * choose a specific wallet; omit it to use the first discovered wallet.
   */
  connectExternal(walletName?: string): Promise<void>;

  /**
   * Browser-injected Solana wallets discovered via the Wallet Standard.
   * Empty when none are installed (the usual case on mobile browsers — Privy
   * social login is the path there).
   */
  externalWallets: ExternalWalletOption[];

  /** Disconnect the wallet and clear the Rise session. */
  disconnect(): Promise<void>;

  /**
   * Open Privy's secure modal to reveal the embedded wallet's private key.
   * Only meaningful for `wallet.kind === "privy-embedded"` — rejects for an
   * external wallet (those manage their own keys). The raw key is shown only
   * inside Privy's iframe; it never passes through app code.
   */
  exportPrivateKey(): Promise<void>;
}
