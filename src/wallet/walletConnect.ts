"use client";

/**
 * WalletConnect (v2) Solana backend — primarily for Solflare on mobile.
 *
 * Mobile Safari / Chrome have no browser extensions, so the Wallet Standard
 * discovery in `walletStandard.ts` finds nothing and Phantom/Solflare can't be
 * connected the desktop way. WalletConnect bridges that gap: a relay pairing is
 * created, its `wc:` URI is deep-linked into the Solflare app, and the wallet
 * keeps a session alive on the relay. Subsequent `solana_signTransaction` /
 * `solana_signMessage` calls round-trip over that session WITHOUT a page reload
 * — the key UX win over raw deeplink protocols.
 *
 * `@walletconnect/universal-provider` is pulled in with a dynamic import so it
 * stays out of the initial bundle; it is only fetched when the user actually
 * picks this connect option.
 *
 * Wire formats (WalletConnect Solana RPC spec):
 *   - solana_signTransaction: params `{ transaction: <base64> }`,
 *     result `{ signature: <base58> }` (and optionally `{ transaction }`).
 *   - solana_signMessage: params `{ message: <base58>, pubkey }`,
 *     result `{ signature: <base58> }`.
 *
 * OWNED BY: Auth & Wallet agent (`src/wallet/`).
 */

import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Address,
  type SignatureBytes,
} from "@solana/kit";
import type { AuthSession, PhoenixClient } from "@ellipsis-labs/rise";
import type { UniversalProvider as WcProvider } from "@walletconnect/universal-provider";
import { WALLETCONNECT_PROJECT_ID } from "@/lib/constants";
import type { AppWallet, SignedTransaction, UnsignedTransaction } from "./types";

/** CAIP-2 id for Solana mainnet-beta (genesis-hash prefix). */
const WC_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** Solana RPC methods requested over the WalletConnect session. */
const WC_METHODS = ["solana_signTransaction", "solana_signMessage"];

/** Native deeplink scheme of the Solflare mobile app. */
const SOLFLARE_SCHEME = "solflare://";

/** Wrap a `wc:` pairing URI in a Solflare deeplink. */
function solflareDeeplink(wcUri: string): string {
  return `${SOLFLARE_SCHEME}wc?uri=${encodeURIComponent(wcUri)}`;
}

/** Best-effort: bring the Solflare app to the foreground for an approval. */
function foregroundSolflare(): void {
  try {
    window.location.href = SOLFLARE_SCHEME;
  } catch {
    // Best-effort — Solflare also surfaces the request via a push.
  }
}

/* -------------------------------------------------------------------------- */
/* Provider singleton                                                         */
/* -------------------------------------------------------------------------- */

/** Lazily-initialised UniversalProvider. One instance for the page lifetime. */
let providerPromise: Promise<WcProvider> | null = null;

async function getProvider(): Promise<WcProvider> {
  if (!providerPromise) {
    providerPromise = (async () => {
      const { UniversalProvider } = await import(
        "@walletconnect/universal-provider"
      );
      return UniversalProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: {
          name: "Vibhu",
          description: "Trade perpetual futures on Solana.",
          url: window.location.origin,
          icons: [`${window.location.origin}/icon.svg`],
        },
      });
    })();
  }
  return providerPromise;
}

/* -------------------------------------------------------------------------- */
/* Session helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Structural shape of the bits of a WalletConnect session we read. */
interface WcSession {
  namespaces?: { solana?: { accounts?: string[] } };
}

/** Pull the first Solana address out of a session's CAIP-10 account list. */
function firstSolanaAddress(session: WcSession | undefined): string | undefined {
  const accounts = session?.namespaces?.solana?.accounts ?? [];
  // CAIP-10 account id: "solana:<chain>:<address>".
  const parts = accounts[0]?.split(":");
  return parts && parts.length === 3 ? parts[2] : undefined;
}

/* -------------------------------------------------------------------------- */
/* AppWallet                                                                  */
/* -------------------------------------------------------------------------- */

/** Build an `AppWallet` backed by a connected WalletConnect (Solflare) session. */
function createWalletConnectWallet(deps: {
  client: PhoenixClient;
  provider: WcProvider;
  addr: Address;
}): AppWallet {
  const { client, provider, addr } = deps;

  /** Send a Solana RPC request over the session, foregrounding Solflare first. */
  const request = async <T>(method: string, params: unknown): Promise<T> => {
    foregroundSolflare();
    return provider.request<T>({ method, params }, WC_SOLANA_CHAIN);
  };

  return {
    kind: "walletconnect",
    authority: addr,
    isConnected: true,

    async signTransaction(
      tx: UnsignedTransaction,
    ): Promise<SignedTransaction> {
      const wireBytes = new Uint8Array(getTransactionEncoder().encode(tx));
      const transaction = getBase64Decoder().decode(wireBytes);
      const res = await request<{ signature?: string; transaction?: string }>(
        "solana_signTransaction",
        { transaction },
      );
      // Solflare may echo the fully-signed transaction — prefer it when present.
      if (res.transaction) {
        return getTransactionDecoder().decode(
          new Uint8Array(getBase64Encoder().encode(res.transaction)),
        );
      }
      // Otherwise it returns just the base58 signature — attach it to the tx.
      if (res.signature) {
        const sig = new Uint8Array(
          getBase58Encoder().encode(res.signature),
        ) as SignatureBytes;
        return { ...tx, signatures: { ...tx.signatures, [addr]: sig } };
      }
      throw new Error("Solflare returned no signature for the transaction.");
    },

    async loginToRise(): Promise<AuthSession> {
      const auth = client.auth;
      if (!auth) {
        throw new Error(
          "[wallet] Rise client has no auth client — RiseClientProvider must set `auth: true`.",
        );
      }
      // 1. Get a server nonce + the exact message string to sign.
      const nonce = await auth.getWalletNonce(addr);
      // 2. `solana_signMessage` expects a base58-encoded message.
      const message = getBase58Decoder().decode(
        new TextEncoder().encode(nonce.message),
      );
      const res = await request<{ signature: string }>("solana_signMessage", {
        message,
        pubkey: addr,
      });
      // 3. WC returns the signature already base58-encoded — exactly the form
      //    the Rise auth API expects.
      return auth.loginWithWalletSignature(addr, res.signature, nonce.nonce_id);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Open a WalletConnect session with Solflare and return a logged-in `AppWallet`.
 *
 * `onDeeplink` receives the Solflare deeplink as soon as the pairing URI is
 * ready; the call also fires the deeplink itself. The callback lets the caller
 * render a manual "Open Solflare" link as a fallback when the browser blocks
 * the programmatic navigation (common on iOS outside a user gesture).
 */
export async function connectWalletConnect(
  client: PhoenixClient,
  onDeeplink: (deeplink: string) => void,
): Promise<AppWallet> {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error("WalletConnect is not configured.");
  }
  const provider = await getProvider();

  // The `wc:` URI is emitted once the relay pairing is ready.
  const onUri = (uri: string) => {
    const deeplink = solflareDeeplink(uri);
    onDeeplink(deeplink);
    try {
      window.location.href = deeplink;
    } catch {
      // Best-effort — the manual link from `onDeeplink` is the fallback.
    }
  };
  provider.on("display_uri", onUri);

  let session: WcSession | undefined;
  try {
    session = (await provider.connect({
      namespaces: {
        solana: {
          chains: [WC_SOLANA_CHAIN],
          methods: WC_METHODS,
          events: [],
        },
      },
    })) as WcSession | undefined;
  } finally {
    provider.removeListener("display_uri", onUri);
  }

  const wcAddress = firstSolanaAddress(session);
  if (!wcAddress) {
    throw new Error("Solflare did not return a Solana account.");
  }

  const wallet = createWalletConnectWallet({
    client,
    provider,
    addr: address(wcAddress),
  });
  await wallet.loginToRise();
  return wallet;
}

/** Tear down any active WalletConnect session. Best-effort. */
export async function teardownWalletConnect(): Promise<void> {
  if (!providerPromise) return;
  try {
    const provider = await providerPromise;
    if (provider.session) await provider.disconnect();
  } catch {
    // Best-effort — local wallet state is cleared regardless.
  }
}
