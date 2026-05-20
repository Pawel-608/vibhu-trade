"use client";

/**
 * Wallet abstraction — provider + `useWallet()` hook.
 *
 * Exposes a single wallet-agnostic context (PLAN.md §4). Both the Privy
 * embedded-wallet path and the external-wallet path resolve to the same
 * `AppWallet` interface so the rest of the app never branches on wallet kind.
 *
 * Both backends authenticate to the Phoenix API the SAME way — the
 * wallet-signature flow:
 *   `client.auth.getWalletNonce(pubkey)` -> the wallet signs the returned
 *   nonce message -> `client.auth.loginWithWalletSignature(pubkey, sig, id)`.
 * The only difference is which wallet signs.
 *
 * This app runs its OWN Privy app (not phoenix.trade's), so `loginWithPrivyToken`
 * is NOT usable — that endpoint only accepts tokens minted by phoenix.trade's
 * own Privy app. Instead the Privy embedded Solana wallet signs the Phoenix
 * nonce just like an external wallet would.
 *
 * Two backends:
 *   - Privy:    `@privy-io/react-auth` social login -> embedded Solana wallet
 *               -> embedded wallet signs the Phoenix nonce message
 *               -> `client.auth.loginWithWalletSignature(...)`.
 *               Active only when `PRIVY_ENABLED` (a Privy app ID is set), since
 *               the Privy hooks require `<PrivyProvider>` to be mounted.
 *   - External: Solana Wallet Standard wallet -> `client.auth.getWalletNonce()`
 *               -> sign message -> `client.auth.loginWithWalletSignature(...)`.
 *
 * When `PRIVY_ENABLED` is true BOTH `connectPrivy` and `connectExternal` are
 * available simultaneously; when false, only `connectExternal`.
 *
 * The component picks the Privy-backed implementation at module scope when
 * `PRIVY_ENABLED` is true, and the external-only implementation otherwise.
 * This keeps Privy hooks from ever running without their provider.
 *
 * OWNED BY: Auth & Wallet agent (`src/wallet/`). Do not edit outside that dir.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getBase58Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Transaction,
} from "@solana/kit";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction as useSolanaSignTransaction,
  useSignMessage as useSolanaSignMessage,
  useCreateWallet as useCreateSolanaWallet,
  useExportWallet as useSolanaExportWallet,
  type ConnectedStandardSolanaWallet,
  type UseSignTransaction,
  type UseSignMessage,
} from "@privy-io/react-auth/solana";
import type { AuthSession, PhoenixClient } from "@ellipsis-labs/rise";
import { usePhoenixClient } from "@/providers/RiseClientProvider";
import { PRIVY_ENABLED } from "@/lib/constants";
import type {
  AppWallet,
  ExternalWalletOption,
  SignedTransaction,
  UnsignedTransaction,
  WalletContextValue,
} from "./types";
import {
  connectWallet,
  disconnectWallet,
  getSolanaWallets,
  signMessageWith,
  signTransactionWith,
  type StandardWallet,
  type StandardWalletAccount,
} from "./walletStandard";

const WalletContext = createContext<WalletContextValue | null>(null);

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Serialize a `@solana/kit` transaction to wire bytes for an external signer. */
function serializeTransaction(tx: Transaction): Uint8Array {
  // VERIFY: `getTransactionEncoder().encode()` returns the wire-format bytes
  // of a (possibly partially-signed) kit v4 Transaction.
  return new Uint8Array(getTransactionEncoder().encode(tx));
}

/** Decode signed wire bytes back into a `@solana/kit` transaction. */
function deserializeTransaction(bytes: Uint8Array): Transaction {
  // VERIFY: `getTransactionDecoder().decode()` reconstructs a kit v4
  // Transaction (with its `signatures` map populated) from wire bytes.
  return getTransactionDecoder().decode(bytes);
}

/** Require the Rise auth client; it only exists when the client has `auth: true`. */
function requireAuth(client: PhoenixClient) {
  if (!client.auth) {
    throw new Error(
      "[wallet] Rise client has no auth client — RiseClientProvider must set `auth: true`.",
    );
  }
  return client.auth;
}

/* -------------------------------------------------------------------------- */
/* External-wallet AppWallet                                                  */
/* -------------------------------------------------------------------------- */

interface ExternalWalletDeps {
  client: PhoenixClient;
  wallet: StandardWallet;
  account: StandardWalletAccount;
}

/** Build an `AppWallet` backed by a connected Wallet Standard wallet. */
function createExternalWallet({
  client,
  wallet,
  account,
}: ExternalWalletDeps): AppWallet {
  return {
    kind: "external",
    authority: account.address,
    isConnected: true,

    async signTransaction(
      tx: UnsignedTransaction,
    ): Promise<SignedTransaction> {
      const signedBytes = await signTransactionWith(
        wallet,
        account,
        serializeTransaction(tx),
      );
      return deserializeTransaction(signedBytes);
    },

    async loginToRise(): Promise<AuthSession> {
      const auth = requireAuth(client);
      // 1. Get a server nonce + the exact message string to sign.
      const nonce = await auth.getWalletNonce(account.address);
      // 2. Sign the message bytes with the external wallet.
      const messageBytes = new TextEncoder().encode(nonce.message);
      const signatureBytes = await signMessageWith(
        wallet,
        account,
        messageBytes,
      );
      // 3. Exchange the signature for a Rise session. The API expects the
      //    signature base58-encoded.
      const signature = encodeBase58(signatureBytes);
      return auth.loginWithWalletSignature(
        account.address,
        signature,
        nonce.nonce_id,
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Privy embedded-wallet AppWallet                                            */
/* -------------------------------------------------------------------------- */

interface PrivyWalletDeps {
  client: PhoenixClient;
  embeddedWallet: ConnectedStandardSolanaWallet;
  signTransaction: UseSignTransaction["signTransaction"];
  signMessage: UseSignMessage["signMessage"];
}

/**
 * Build an `AppWallet` backed by the Privy embedded Solana wallet.
 *
 * Authentication uses the SAME wallet-signature flow as an external wallet:
 * the embedded wallet signs the Phoenix nonce message. `loginWithPrivyToken`
 * is intentionally NOT used — this app runs its own Privy app and that
 * endpoint only accepts tokens from phoenix.trade's Privy app.
 */
function createPrivyWallet({
  client,
  embeddedWallet,
  signTransaction,
  signMessage,
}: PrivyWalletDeps): AppWallet {
  return {
    kind: "privy-embedded",
    authority: embeddedWallet.address,
    isConnected: true,

    async signTransaction(
      tx: UnsignedTransaction,
    ): Promise<SignedTransaction> {
      // The Privy↔@solana/kit bridge (PLAN.md §10): Privy signs raw wire
      // bytes; we serialize the kit transaction, sign, then re-decode.
      const { signedTransaction } = await signTransaction({
        transaction: serializeTransaction(tx),
        wallet: embeddedWallet,
      });
      return deserializeTransaction(signedTransaction);
    },

    async loginToRise(): Promise<AuthSession> {
      const auth = requireAuth(client);
      // 1. Get a server nonce + the exact message string to sign.
      const nonce = await auth.getWalletNonce(embeddedWallet.address);
      // 2. Sign the message bytes with the Privy embedded wallet.
      const messageBytes = new TextEncoder().encode(nonce.message);
      const { signature: signatureBytes } = await signMessage({
        message: messageBytes,
        wallet: embeddedWallet,
      });
      // 3. Exchange the signature for a Rise session. The API expects the
      //    signature base58-encoded.
      const signature = encodeBase58(signatureBytes);
      return auth.loginWithWalletSignature(
        embeddedWallet.address,
        signature,
        nonce.nonce_id,
      );
    },
  };
}

/** Encode raw signature bytes to a base58 string for the Rise auth API. */
function encodeBase58(bytes: Uint8Array): string {
  return getBase58Decoder().decode(bytes);
}

/* -------------------------------------------------------------------------- */
/* External-wallet discovery                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Discover browser-injected Solana wallets (Phantom, Solflare, Backpack, …)
 * via the Wallet Standard. Injected wallets can register slightly after page
 * load, so this polls briefly after mount and also reacts to late
 * registrations — keeping the picker list current without a hard reload.
 */
function useDiscoveredWallets(): ExternalWalletOption[] {
  const [wallets, setWallets] = useState<ExternalWalletOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      const found = getSolanaWallets().map((w) => ({
        name: w.name,
        icon: w.icon,
      }));
      // Only replace state when the set of wallet names actually changed, so
      // consumers do not re-render on every poll tick.
      setWallets((prev) =>
        prev.map((w) => w.name).join("|") === found.map((w) => w.name).join("|")
          ? prev
          : found,
      );
    };

    read();
    const interval = setInterval(read, 400);
    const stop = setTimeout(() => clearInterval(interval), 4000);
    const onRegister = () => read();
    window.addEventListener("wallet-standard:register-wallet", onRegister);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(stop);
      window.removeEventListener("wallet-standard:register-wallet", onRegister);
    };
  }, []);

  return wallets;
}

/* -------------------------------------------------------------------------- */
/* Privy-backed provider                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Provider variant used when Privy is configured. Calls Privy hooks, so it is
 * only ever rendered inside `<PrivyProvider>` (guaranteed by `PRIVY_ENABLED`).
 */
function PrivyWalletProvider({ children }: { children: ReactNode }) {
  const client = usePhoenixClient();
  const { ready, authenticated, logout } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSolanaSignTransaction();
  const { signMessage } = useSolanaSignMessage();
  const { createWallet } = useCreateSolanaWallet();
  const { exportWallet } = useSolanaExportWallet();

  const [wallet, setWallet] = useState<AppWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const externalWallets = useDiscoveredWallets();

  // Privy creates the embedded wallet asynchronously after login, so the
  // `solanaWallets` array changes across renders. `connectPrivy` polls for it;
  // a ref keeps the polling loop reading the *latest* array rather than a
  // stale closure snapshot.
  const solanaWalletsRef = useRef(solanaWallets);
  solanaWalletsRef.current = solanaWallets;

  // `useLogin` resolves the modal flow; we resolve our promise from its
  // callbacks so `connectPrivy()` awaits the full login.
  const loginResolver = useRef<{
    resolve: () => void;
    reject: (e: unknown) => void;
  } | null>(null);

  const { login } = useLogin({
    onComplete: () => {
      loginResolver.current?.resolve();
      loginResolver.current = null;
    },
    onError: (error) => {
      // Privy reports a `PrivyErrorCode` string here.
      loginResolver.current?.reject(
        new Error(`Privy login failed: ${String(error)}`),
      );
      loginResolver.current = null;
    },
  });

  /** Pick the embedded (Privy) Solana wallet from the *current* wallet list. */
  const findEmbeddedWallet = useCallback(():
    | ConnectedStandardSolanaWallet
    | undefined => {
    const wallets = solanaWalletsRef.current;
    // The embedded wallet is the one whose underlying standard wallet is the
    // Privy wallet implementation.
    return (
      wallets.find(
        (w) =>
          (w.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet ===
          true,
      ) ?? wallets[0]
    );
  }, []);

  const connectPrivy = useCallback(async () => {
    setIsConnecting(true);
    try {
      // 1. Drive the Privy login modal (social / email). Skip if already in.
      if (!(ready && authenticated)) {
        await new Promise<void>((resolve, reject) => {
          loginResolver.current = { resolve, reject };
          login();
        });
      }

      // 2. Wait briefly for the embedded Solana wallet to materialize. Privy
      //    auto-creates it on first login (`createOnLogin` in the provider
      //    config); the hook list updates asynchronously.
      let embedded = findEmbeddedWallet();
      for (let i = 0; i < 30 && !embedded; i++) {
        await new Promise((r) => setTimeout(r, 200));
        embedded = findEmbeddedWallet();
      }

      // 3. If auto-creation did not surface a wallet, provision one explicitly,
      //    then poll once more for it to appear in the standard-wallets list.
      if (!embedded) {
        try {
          await createWallet();
        } catch {
          // The user may already have a wallet that simply hasn't surfaced
          // yet; fall through to the final poll before giving up.
        }
        for (let i = 0; i < 30 && !embedded; i++) {
          await new Promise((r) => setTimeout(r, 200));
          embedded = findEmbeddedWallet();
        }
      }

      if (!embedded) {
        throw new Error(
          "[wallet] No Privy embedded Solana wallet available after login.",
        );
      }

      // 4. Build the AppWallet and mint a Rise session via the embedded
      //    wallet's signature over the Phoenix nonce message.
      const appWallet = createPrivyWallet({
        client,
        embeddedWallet: embedded,
        signTransaction,
        signMessage,
      });
      await appWallet.loginToRise();
      setWallet(appWallet);
    } finally {
      setIsConnecting(false);
    }
  }, [
    ready,
    authenticated,
    login,
    findEmbeddedWallet,
    createWallet,
    client,
    signTransaction,
    signMessage,
  ]);

  const connectExternal = useCallback(
    async (walletName?: string) => {
      setIsConnecting(true);
      try {
        const { appWallet } = await connectExternalWallet(client, walletName);
        setWallet(appWallet);
      } finally {
        setIsConnecting(false);
      }
    },
    [client],
  );

  const disconnect = useCallback(async () => {
    try {
      await requireAuth(client).logout();
    } catch {
      // Logout is best-effort — clear local state regardless.
    }
    if (authenticated) {
      try {
        await logout();
      } catch {
        // Ignore Privy logout failures.
      }
    }
    setWallet(null);
  }, [client, authenticated, logout]);

  const exportPrivateKey = useCallback(async () => {
    if (!wallet || wallet.kind !== "privy-embedded") {
      throw new Error(
        "Key export is only available for the Privy embedded wallet.",
      );
    }
    // Opens Privy's secure export modal — the raw key is shown only inside
    // Privy's iframe and never passes through app code. Resolves on close.
    await exportWallet({ address: wallet.authority });
  }, [wallet, exportWallet]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      isConnecting,
      connectPrivy,
      connectExternal,
      externalWallets,
      disconnect,
      exportPrivateKey,
    }),
    [
      wallet,
      isConnecting,
      connectPrivy,
      connectExternal,
      externalWallets,
      disconnect,
      exportPrivateKey,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* External-only provider (Privy disabled)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Shared external-wallet connect routine (used by both provider variants).
 *
 * `walletName` selects a specific discovered wallet by its Wallet Standard
 * name; when omitted, the first discovered wallet is used. Returns both the
 * `AppWallet` and the underlying `StandardWallet` so the caller can later
 * disconnect it.
 */
async function connectExternalWallet(
  client: PhoenixClient,
  walletName?: string,
): Promise<{ appWallet: AppWallet; standardWallet: StandardWallet }> {
  const wallets = getSolanaWallets();
  if (wallets.length === 0) {
    throw new Error(
      "No Solana wallet detected. Install Phantom, Solflare, or Backpack.",
    );
  }
  const standardWallet = walletName
    ? wallets.find((w) => w.name === walletName)
    : wallets[0];
  if (!standardWallet) {
    throw new Error(`Wallet "${walletName}" is not available.`);
  }
  const account = await connectWallet(standardWallet);
  const appWallet = createExternalWallet({
    client,
    wallet: standardWallet,
    account,
  });
  await appWallet.loginToRise();
  return { appWallet, standardWallet };
}

/**
 * Provider variant used when Privy is not configured. Calls no Privy hooks so
 * it is safe to render without `<PrivyProvider>`.
 */
function ExternalOnlyWalletProvider({ children }: { children: ReactNode }) {
  const client = usePhoenixClient();
  const [wallet, setWallet] = useState<AppWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const externalWallets = useDiscoveredWallets();
  const activeWallet = useRef<StandardWallet | null>(null);

  const connectExternal = useCallback(
    async (walletName?: string) => {
      setIsConnecting(true);
      try {
        const { appWallet, standardWallet } = await connectExternalWallet(
          client,
          walletName,
        );
        activeWallet.current = standardWallet;
        setWallet(appWallet);
      } finally {
        setIsConnecting(false);
      }
    },
    [client],
  );

  const connectPrivy = useCallback(async () => {
    throw new Error(
      "[wallet] Privy login is disabled — NEXT_PUBLIC_PRIVY_APP_ID is not set.",
    );
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await requireAuth(client).logout();
    } catch {
      // Best-effort.
    }
    if (activeWallet.current) {
      await disconnectWallet(activeWallet.current);
      activeWallet.current = null;
    }
    setWallet(null);
  }, [client]);

  const exportPrivateKey = useCallback(async () => {
    throw new Error(
      "Private-key export is only available for the embedded wallet.",
    );
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      isConnecting,
      connectPrivy,
      connectExternal,
      externalWallets,
      disconnect,
      exportPrivateKey,
    }),
    [
      wallet,
      isConnecting,
      connectPrivy,
      connectExternal,
      externalWallets,
      disconnect,
      exportPrivateKey,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Public provider + hook                                                     */
/* -------------------------------------------------------------------------- */

export function WalletProvider({ children }: { children: ReactNode }) {
  // Choose the backend by configuration. `PRIVY_ENABLED` is a build-time
  // constant, so the hook set is stable for the life of the app — the Rules of
  // Hooks are not violated by this branch.
  return PRIVY_ENABLED ? (
    <PrivyWalletProvider>{children}</PrivyWalletProvider>
  ) : (
    <ExternalOnlyWalletProvider>{children}</ExternalOnlyWalletProvider>
  );
}

/** Access the wallet context. Throws if used outside `<WalletProvider>`. */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet() must be used within <WalletProvider>.");
  }
  return ctx;
}
