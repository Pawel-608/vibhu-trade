/**
 * submitTransaction — transaction assembly / submit / confirm helper.
 *
 * Public surface shared with the Account agent (`CollateralActions`). Takes the
 * Rise SDK's `@solana/kit` instructions (from `client.ixs` / `client.orderPackets`,
 * already Flight-wrapped when the client carries a `flight` config), assembles a
 * `@solana/kit` v0 transaction message, has the active `AppWallet` sign it,
 * submits it through the Solana RPC, and confirms it.
 *
 * Pipeline (PLAN.md §3 "Sending transactions"):
 *   1. build instructions with `client.ixs` / `client.orderPackets`,
 *   2. assemble a `@solana/kit` transaction message (fee payer + blockhash),
 *   3. sign with `AppWallet.signTransaction`,
 *   4. submit through the RPC,
 *   5. confirm by polling signature status.
 *
 * The wallet contract keeps `UnsignedTransaction` / `SignedTransaction` loose
 * (`unknown`) so the shared wallet layer does not pin a `@solana/kit` version.
 * This helper narrows them: it hands the wallet a compiled `@solana/kit`
 * `Transaction` and expects a signed `Transaction` (or a base64 wire string)
 * back. Both Privy- and external-wallet implementations resolve to that.
 *
 * OWNED BY: Trading agent (`src/trading/`).
 */

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
  type Transaction,
} from "@solana/kit";
import type {
  InstructionsWithAccountsAndData,
  PhoenixClient,
} from "@ellipsis-labs/rise";
import type { AppWallet, UnsignedTransaction } from "@/wallet/types";
import type { TxResult } from "@/types";

/** A single Rise SDK instruction (kit-shaped: accounts + data + program). */
export type RiseInstruction = InstructionsWithAccountsAndData;

export interface SubmitTransactionArgs {
  /**
   * The shared Rise client (from `usePhoenixClient()`). Currently reserved —
   * instructions are built by the caller and submitted via the RPC endpoint —
   * but kept in the contract so callers always pass it (Account agent relies
   * on this stable shape).
   */
  client?: PhoenixClient;
  /** The active wallet (from `useWallet()`). */
  wallet: AppWallet;
  /**
   * One or more Rise SDK instructions to assemble into a single transaction.
   * Order is preserved. Pass either a single instruction or an array.
   *
   * Preferred field. `transaction` is accepted as a back-compatible alias —
   * exactly one of `instructions` / `transaction` must be provided.
   */
  instructions?: RiseInstruction | readonly RiseInstruction[];
  /**
   * Back-compat alias for {@link SubmitTransactionArgs.instructions}. The
   * wallet contract types this `UnsignedTransaction` (`unknown`); in practice
   * callers pass the Rise SDK instruction(s) to assemble — this helper builds
   * and signs the transaction internally.
   */
  transaction?: UnsignedTransaction;
  /** Optional explicit RPC HTTP endpoint. Falls back to the app's `/api/rpc` proxy. */
  rpcUrl?: string;
  /** Confirmation commitment level. Defaults to `"confirmed"`. */
  commitment?: "processed" | "confirmed" | "finalized";
}

/** Thrown when a transaction is submitted but never lands within the timeout. */
export class TransactionConfirmationError extends Error {
  constructor(
    message: string,
    /** The signature, if the transaction was at least submitted. */
    readonly signature?: string,
  ) {
    super(message);
    this.name = "TransactionConfirmationError";
  }
}

/** The app RPC proxy route — hides the paid RPC key (PLAN.md §3). */
const DEFAULT_RPC_URL = "/api/rpc";

/** How long to poll for confirmation before giving up. */
const CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_INTERVAL_MS = 1_500;

/**
 * Compute-unit limit prepended to every transaction. Account-heavy Phoenix
 * instructions (opening a position alongside existing ones, brackets,
 * conditional orders) can exceed the 200k-CU default and fail; the Rust CLI
 * (`vulcan` — `send_or_dry_run`) raises it the same way. 400k is a safe ceiling.
 */
const COMPUTE_UNIT_LIMIT = 400_000;

/** The SPL ComputeBudget program address. */
const COMPUTE_BUDGET_PROGRAM_ADDRESS = address(
  "ComputeBudget111111111111111111111111111111",
);

/**
 * Build a `SetComputeUnitLimit` ComputeBudget instruction.
 * Wire format: 1-byte discriminant (`2`) + u32 LE compute-unit limit.
 */
function setComputeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit
  new DataView(data.buffer).setUint32(1, units, true);
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS,
    accounts: [],
    data,
  };
}

interface LatestBlockhash {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
}

/** Resolve the RPC HTTP endpoint to an absolute URL usable by `fetch`. */
function resolveRpcUrl(rpcUrl: string | undefined): string {
  const url = rpcUrl && rpcUrl.length > 0 ? rpcUrl : DEFAULT_RPC_URL;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window !== "undefined") {
    return new URL(url, window.location.origin).toString();
  }
  return url;
}

/** Minimal JSON-RPC POST helper against the Solana RPC. */
async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`RPC ${method} failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    result?: T;
    error?: {
      message?: string;
      code?: number;
      data?: { err?: unknown; logs?: string[] };
    };
  };
  if (json.error) {
    const { code, message, data } = json.error;
    // A failed preflight carries the on-chain program logs in `data.logs` —
    // they pinpoint which instruction / program / account rejected the tx.
    // The minimal error message alone ("invalid account data for instruction")
    // is not actionable without them, so dump the full log to the console.
    if (data?.logs && data.logs.length > 0) {
      console.error(
        `[trading] ${method} simulation failed — Solana program logs:\n` +
          data.logs.join("\n"),
      );
    }
    throw new Error(
      `RPC ${method} error${code !== undefined ? ` ${code}` : ""}: ${
        message ?? "unknown"
      }${data?.logs?.length ? " (full program logs in the console)" : ""}`,
    );
  }
  return json.result as T;
}

async function getLatestBlockhash(
  endpoint: string,
  commitment: string,
): Promise<LatestBlockhash> {
  const result = await rpcCall<{
    value: { blockhash: string; lastValidBlockHeight: number };
  }>(endpoint, "getLatestBlockhash", [{ commitment }]);
  return {
    blockhash: result.value.blockhash as Blockhash,
    lastValidBlockHeight: BigInt(result.value.lastValidBlockHeight),
  };
}

/** A signed transaction can come back from the wallet as a kit `Transaction` or wire string. */
function toBase64Wire(signed: unknown): string {
  if (typeof signed === "string") return signed;
  if (signed && typeof signed === "object") {
    const maybeTx = signed as Partial<Transaction>;
    if (maybeTx.messageBytes && maybeTx.signatures) {
      return getBase64EncodedWireTransaction(signed as Transaction);
    }
  }
  throw new Error(
    "[trading] wallet.signTransaction returned an unrecognised value — " +
      "expected a @solana/kit Transaction or a base64 wire string.",
  );
}

/** Poll signature status until the transaction confirms, fails, or times out. */
async function confirmSignature(
  endpoint: string,
  signature: string,
  commitment: "processed" | "confirmed" | "finalized",
): Promise<boolean> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  const wantStatuses: string[] =
    commitment === "finalized"
      ? ["finalized"]
      : commitment === "confirmed"
        ? ["confirmed", "finalized"]
        : ["processed", "confirmed", "finalized"];

  while (Date.now() < deadline) {
    const result = await rpcCall<{
      value: Array<{
        confirmationStatus: string | null;
        err: unknown;
      } | null>;
    }>(endpoint, "getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: false },
    ]);
    const status = result.value[0];
    if (status) {
      if (status.err) {
        throw new TransactionConfirmationError(
          `Transaction failed on-chain: ${JSON.stringify(status.err)}`,
          signature,
        );
      }
      if (
        status.confirmationStatus &&
        wantStatuses.includes(status.confirmationStatus)
      ) {
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_INTERVAL_MS));
  }
  throw new TransactionConfirmationError(
    "Transaction was submitted but not confirmed within the timeout.",
    signature,
  );
}

/**
 * Build, sign, submit and confirm a transaction from Rise SDK instructions.
 * Returns the signature and whether it confirmed.
 *
 * Throws on assembly / signing / submission failure. A submitted-but-unconfirmed
 * transaction throws a {@link TransactionConfirmationError} carrying the signature.
 */
export async function submitTransaction(
  args: SubmitTransactionArgs,
): Promise<TxResult> {
  const { wallet } = args;
  const commitment = args.commitment ?? "confirmed";

  if (!wallet.isConnected || !wallet.authority) {
    throw new Error("[trading] no wallet connected — cannot submit transaction.");
  }

  // Accept instructions from either `instructions` (preferred) or the
  // back-compat `transaction` alias.
  const source = args.instructions ?? args.transaction;
  if (source === undefined || source === null) {
    throw new Error(
      "[trading] submitTransaction requires `instructions` (or `transaction`).",
    );
  }
  const ixs = (
    Array.isArray(source) ? source : [source]
  ) as readonly RiseInstruction[];
  if (ixs.length === 0) {
    throw new Error("[trading] submitTransaction called with no instructions.");
  }

  // The Rise client builds instructions only; transaction submission goes
  // through our own RPC endpoint (the `/api/rpc` proxy by default).
  const rpcEndpoint = resolveRpcUrl(args.rpcUrl);

  const feePayer = address(wallet.authority);
  const latestBlockhash = await getLatestBlockhash(rpcEndpoint, commitment);

  // Prepend a compute-budget instruction so account-heavy Phoenix transactions
  // do not hit the 200k-CU default and fail (mirrors the Rust CLI).
  const allIxs: Instruction[] = [
    setComputeUnitLimitIx(COMPUTE_UNIT_LIMIT),
    ...(ixs as readonly Instruction[]),
  ];

  // Assemble a v0 transaction message: fee payer + blockhash lifetime + ixs.
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(feePayer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(allIxs, tx),
  );

  // Compile to an unsigned transaction and hand it to the wallet to sign.
  const compiled = compileTransaction(transactionMessage);
  const signed = await wallet.signTransaction(compiled);
  const wire = toBase64Wire(signed);

  // Submit. `getSignatureFromTransaction` reads the signature off the signed tx
  // when available; otherwise the RPC echoes it back.
  let signature: string;
  try {
    signature = getSignatureFromTransaction(signed as Transaction);
  } catch {
    signature = "";
  }

  const submitted = await rpcCall<string>(rpcEndpoint, "sendTransaction", [
    wire,
    {
      encoding: "base64",
      skipPreflight: false,
      // Preflight MUST simulate at the SAME commitment the blockhash was
      // fetched at (`getLatestBlockhash` above uses `commitment`). The RPC
      // defaults `preflightCommitment` to "finalized" — ~32 slots behind — so a
      // "confirmed"-tip blockhash is not yet in the finalized bank and the
      // simulation fails with "Blockhash not found". Matching them fixes that.
      preflightCommitment: commitment,
      maxRetries: 3,
    },
  ]);
  if (submitted) signature = submitted;

  if (!signature) {
    throw new Error("[trading] RPC did not return a transaction signature.");
  }

  const confirmed = await confirmSignature(rpcEndpoint, signature, commitment);
  return { signature, confirmed };
}
