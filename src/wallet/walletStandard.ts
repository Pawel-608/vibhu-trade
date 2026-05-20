/**
 * Minimal Solana Wallet Standard discovery.
 *
 * The external-wallet fallback path needs to find browser-injected Solana
 * wallets (Phantom, Solflare, Backpack, ...) without pulling in a wallet
 * adapter dependency. The Wallet Standard defines a small, stable
 * `window`-event handshake for exactly this:
 *   - the app dispatches `wallet-standard:app-ready` with an `{ register }`
 *     callback, and
 *   - each wallet dispatches `wallet-standard:register-wallet` with its
 *     callback, OR responds to our app-ready event.
 *
 * We implement just enough of that protocol to enumerate connectable Solana
 * wallets. Types are kept structural (not imported from `@wallet-standard/*`,
 * which is only a transitive dependency) so this file owns its own contract.
 *
 * Ref: https://github.com/wallet-standard/wallet-standard
 *
 * OWNED BY: Auth & Wallet agent (`src/wallet/`).
 */

/** A Wallet Standard account exposed by an injected wallet. */
export interface StandardWalletAccount {
  /** Base58 Solana address. */
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly string[];
  readonly features: readonly string[];
}

/** `solana:signMessage` feature surface. */
interface SignMessageFeature {
  signMessage(
    ...inputs: ReadonlyArray<{ account: StandardWalletAccount; message: Uint8Array }>
  ): Promise<ReadonlyArray<{ signedMessage: Uint8Array; signature: Uint8Array }>>;
}

/** `solana:signTransaction` feature surface. */
interface SignTransactionFeature {
  signTransaction(
    ...inputs: ReadonlyArray<{
      account: StandardWalletAccount;
      transaction: Uint8Array;
      chain?: string;
    }>
  ): Promise<ReadonlyArray<{ signedTransaction: Uint8Array }>>;
}

/** `standard:connect` feature surface. */
interface ConnectFeature {
  connect(input?: {
    silent?: boolean;
  }): Promise<{ accounts: readonly StandardWalletAccount[] }>;
}

/** `standard:disconnect` feature surface. */
interface DisconnectFeature {
  disconnect(): Promise<void>;
}

/** Structural shape of a registered Wallet Standard wallet. */
export interface StandardWallet {
  readonly version: string;
  readonly name: string;
  readonly icon: string;
  readonly chains: readonly string[];
  readonly accounts: readonly StandardWalletAccount[];
  readonly features: Record<string, unknown>;
}

/** Feature identifiers we depend on. */
const FEATURE_CONNECT = "standard:connect";
const FEATURE_DISCONNECT = "standard:disconnect";
const FEATURE_SIGN_MESSAGE = "solana:signMessage";
const FEATURE_SIGN_TRANSACTION = "solana:signTransaction";

/** The Solana mainnet chain identifier used by the Wallet Standard. */
export const SOLANA_MAINNET_CHAIN = "solana:mainnet";

interface WindowAppReadyEventApi {
  register(...wallets: StandardWallet[]): void;
}

/**
 * Module-level registry of discovered wallets, keyed by wallet name. Only
 * Solana-capable wallets are stored — see `registerWallets`.
 */
const registry = new Map<string, StandardWallet>();
let initialized = false;

/**
 * True when a registered wallet can actually be used for Solana: it lists a
 * `solana:` chain and exposes the message- and transaction-signing features.
 *
 * This matters because multi-chain wallets (Phantom, Backpack, …) register a
 * SEPARATE Wallet Standard object per chain — Solana, Bitcoin, Sui, EVM —
 * all sharing the same `name`. Without this check the name-keyed registry
 * lets a non-Solana sibling clobber the Solana object, and the wallet then
 * silently disappears from the picker.
 */
function isSolanaCapable(wallet: StandardWallet): boolean {
  return (
    Array.isArray(wallet.chains) &&
    wallet.chains.some(
      (c) => typeof c === "string" && c.startsWith("solana:"),
    ) &&
    FEATURE_SIGN_MESSAGE in wallet.features &&
    FEATURE_SIGN_TRANSACTION in wallet.features
  );
}

function registerWallets(wallets: readonly StandardWallet[]): void {
  for (const wallet of wallets) {
    // Only Solana-capable wallets enter the registry. This also stops a
    // multi-chain wallet's Bitcoin/Sui/EVM siblings from overwriting its
    // Solana entry under their shared name (see `isSolanaCapable`).
    if (wallet && typeof wallet.name === "string" && isSolanaCapable(wallet)) {
      registry.set(wallet.name, wallet);
    }
  }
}

/**
 * Run the Wallet Standard handshake once. Safe to call repeatedly; only the
 * first call wires up listeners + dispatches the app-ready event.
 */
function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const api: WindowAppReadyEventApi = {
    register: (...wallets) => registerWallets(wallets),
  };

  // Wallets that load AFTER us announce themselves with this event.
  window.addEventListener("wallet-standard:register-wallet", ((
    event: CustomEvent<(api: WindowAppReadyEventApi) => void>,
  ) => {
    try {
      event.detail(api);
    } catch {
      // A misbehaving wallet must not break discovery for the others.
    }
  }) as EventListener);

  // Wallets that loaded BEFORE us respond to this event.
  window.dispatchEvent(
    new CustomEvent("wallet-standard:app-ready", { detail: api }),
  );
}

/** Returns every discovered Solana-capable Wallet Standard wallet. */
export function getSolanaWallets(): StandardWallet[] {
  ensureInitialized();
  // The registry only ever holds Solana-capable wallets (see `registerWallets`).
  return [...registry.values()];
}

function feature<T>(wallet: StandardWallet, id: string): T {
  const f = wallet.features[id];
  if (!f) {
    throw new Error(`Wallet "${wallet.name}" does not support ${id}.`);
  }
  return f as T;
}

/**
 * Connect to a wallet and return its primary Solana account.
 *
 * Always calls the wallet's `connect()` — it never trusts the pre-populated
 * `wallet.accounts`. On page load a wallet may AUTO-CONNECT a stale account
 * (the one this dapp last used) even though the user has since switched their
 * active account. Signing then happens with the *active* account, so a nonce
 * fetched for the stale address fails signature verification on the Phoenix
 * backend (`invalid_wallet_signature`). `connect()` returns the wallet's
 * current account — the same one it will sign with — and is silent (no prompt)
 * for an already-authorized dapp.
 */
export async function connectWallet(
  wallet: StandardWallet,
): Promise<StandardWalletAccount> {
  const connect = feature<ConnectFeature>(wallet, FEATURE_CONNECT);
  const { accounts } = await connect.connect();
  const account = accounts.find((a) =>
    a.chains.some((c) => c.startsWith("solana:")),
  );
  if (!account) {
    throw new Error(`Wallet "${wallet.name}" has no Solana account.`);
  }
  return account;
}

/** Disconnect a wallet if it supports the optional disconnect feature. */
export async function disconnectWallet(wallet: StandardWallet): Promise<void> {
  const f = wallet.features[FEATURE_DISCONNECT] as DisconnectFeature | undefined;
  if (f) {
    try {
      await f.disconnect();
    } catch {
      // Disconnect is best-effort.
    }
  }
}

/** Sign an arbitrary message with a wallet account (used for Rise login). */
export async function signMessageWith(
  wallet: StandardWallet,
  account: StandardWalletAccount,
  message: Uint8Array,
): Promise<Uint8Array> {
  const f = feature<SignMessageFeature>(wallet, FEATURE_SIGN_MESSAGE);
  const [output] = await f.signMessage({ account, message });
  return output.signature;
}

/** Sign a serialized transaction with a wallet account. */
export async function signTransactionWith(
  wallet: StandardWallet,
  account: StandardWalletAccount,
  transaction: Uint8Array,
): Promise<Uint8Array> {
  const f = feature<SignTransactionFeature>(wallet, FEATURE_SIGN_TRANSACTION);
  const [output] = await f.signTransaction({
    account,
    transaction,
    chain: SOLANA_MAINNET_CHAIN,
  });
  return output.signedTransaction;
}
