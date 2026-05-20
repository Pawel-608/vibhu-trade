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

/** Module-level registry of discovered wallets (deduped by name). */
const registry = new Map<string, StandardWallet>();
let initialized = false;

function registerWallets(wallets: readonly StandardWallet[]): void {
  for (const wallet of wallets) {
    if (wallet && typeof wallet.name === "string") {
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
  return [...registry.values()].filter(
    (w) =>
      w.chains.some((c) => c.startsWith("solana:")) &&
      FEATURE_SIGN_MESSAGE in w.features &&
      FEATURE_SIGN_TRANSACTION in w.features,
  );
}

function feature<T>(wallet: StandardWallet, id: string): T {
  const f = wallet.features[id];
  if (!f) {
    throw new Error(`Wallet "${wallet.name}" does not support ${id}.`);
  }
  return f as T;
}

/**
 * Connect to a wallet and return its primary Solana account. Triggers the
 * wallet's approval prompt when not already authorized.
 */
export async function connectWallet(
  wallet: StandardWallet,
): Promise<StandardWalletAccount> {
  const existing = wallet.accounts.find((a) =>
    a.chains.some((c) => c.startsWith("solana:")),
  );
  if (existing) return existing;

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
