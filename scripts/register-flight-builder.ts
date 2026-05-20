/**
 * ============================================================================
 *  Phoenix Mobile — One-time Flight builder-registration tooling
 * ============================================================================
 *
 * WHAT THIS DOES
 * --------------
 * Phoenix perps has a "Flight" builder-routing layer. When order flow from our
 * app is routed through the Flight program, builder fees accrue to a designated
 * builder *trader account*. To turn that on, a one-time registration is needed:
 *
 *   STEP 1 — Register a Phoenix TRADER account for the builder authority.
 *            The builder is itself a Phoenix trader; its trader-account PDA is
 *            what collects builder fees. Without this account the Flight
 *            `register_builder` instruction has nothing to point at.
 *
 *   STEP 2 — Register the builder authority as a Flight BUILDER, binding it to
 *            that trader account and to a configurable `feeBps`. This creates
 *            the Flight `builder_state` PDA on-chain.
 *
 * After both steps land, configuring the app's Phoenix client with
 * `flight: { builderAuthority, builderPdaIndex, builderSubaccountIndex }` makes
 * all Flight-routed limit/market orders pay builder fees into this account.
 * Those fees are later withdrawable from the Phoenix frontend (see RUNBOOK).
 *
 * This is a STANDALONE script — run it with `tsx`, NOT as part of the app:
 *
 *   # dry-run (default — builds + simulates, sends NOTHING):
 *   tsx scripts/register-flight-builder.ts
 *
 *   # actually send the transactions:
 *   tsx scripts/register-flight-builder.ts --execute
 *
 * SAFETY MODEL
 * ------------
 * - Defaults to DRY-RUN. It will print every address, decode every parameter,
 *   and simulate the transaction, but will NOT broadcast unless `--execute` is
 *   passed explicitly.
 * - It is idempotent-friendly: if the builder trader account already exists, it
 *   skips STEP 1. If `register_builder` fails because the builder is already
 *   registered, that is surfaced clearly rather than silently swallowed.
 *
 * SOURCES (Rise SDK @ rise-public)
 * --------------------------------
 * - ts/src/flight/core/ixBuilders/RegisterBuilder/{ix,codec,types}.ts
 * - ts/src/flight/pdas.ts, ts/src/flight/core/constants.ts
 * - ts/src/ixs/operations.ts  (buildRegisterTrader)
 * - ts/examples/05-cancel-all-conditional-orders.ts (tx send pattern)
 * - ts/examples/06-flight-market-order.ts (createPhoenixClient + flight config)
 * - rust/ix/src/flight/register_builder.rs (account layout cross-check)
 * - repo README.md "Flight Builder Activation and Routed Orders"
 * ============================================================================
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import process from "node:process";

import {
  MarginType,
  createPhoenixClient,
  flight,
  type Authority,
} from "@ellipsis-labs/rise";

// NOTE: `@solana/kit` is the umbrella package that re-exports the signer and
// RPC helpers (`@solana/signers`, `@solana/rpc`, ...). phoenix-mobile depends
// on `@solana/kit` directly, so everything we need comes from this one import.
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getBase58Decoder,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Address,
  type Instruction,
} from "@solana/kit";

// ============================================================================
// CONFIG — edit these constants, or override them with environment variables.
// ============================================================================

/**
 * Path to the builder AUTHORITY keypair (a Solana CLI JSON keypair: a 64-byte
 * JSON array). This wallet:
 *   - signs both transactions
 *   - pays the rent + tx fees
 *   - becomes the Flight builder authority
 *   - owns the builder trader account that collects fees
 *
 * Override with env var: BUILDER_KEYPAIR_PATH
 */
const BUILDER_KEYPAIR_PATH =
  process.env.BUILDER_KEYPAIR_PATH ??
  `${homedir()}/.config/solana/phoenix-flight-builder.json`;

/** Solana RPC URL — Solana Vibe Station, from the SOLANA_RPC_URL env var. */
const RPC_URL = process.env.SOLANA_RPC_URL;
if (!RPC_URL) {
  throw new Error(
    "SOLANA_RPC_URL is not set — export your Solana Vibe Station RPC URL before running this script.",
  );
}

/** Phoenix API URL (used for exchange metadata). Override: PHOENIX_API_URL */
const PHOENIX_API_URL =
  process.env.PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";

/**
 * Builder fee, in basis points (1 bps = 0.01%). This is the fee the builder
 * collects on Flight-routed order flow. Pick this deliberately — see RUNBOOK
 * "How to choose feeBps". Encoded on-chain as a u64.
 *
 * Override with env var: FEE_BPS
 */
const FEE_BPS: bigint = BigInt(process.env.FEE_BPS ?? "25");

/**
 * Phoenix trader-PDA index for the builder's trader account (0-255).
 * Keep this 0 unless you have a specific reason. `buildRegisterTrader` in the
 * Rise SDK currently throws on any non-zero traderPdaIndex.
 *
 * Override with env var: BUILDER_PDA_INDEX
 */
const BUILDER_PDA_INDEX: number = Number(process.env.BUILDER_PDA_INDEX ?? "0");

/**
 * Phoenix subaccount index for the builder's trader account (0-255).
 * 0 == cross-margin (the normal choice for a fee-collector account).
 * 1-100 == isolated-margin subaccounts. Keep this 0 for a builder.
 *
 * Override with env var: BUILDER_SUBACCOUNT_INDEX
 */
const BUILDER_SUBACCOUNT_INDEX: number = Number(
  process.env.BUILDER_SUBACCOUNT_INDEX ?? "0"
);

// ============================================================================
// Internal constants / helpers
// ============================================================================

/** When true, build + simulate only. Set by the `--execute` CLI flag. */
const EXECUTE = process.argv.includes("--execute");

const log = (...args: unknown[]) => console.log(...args);
const hr = () => log("-".repeat(76));

const fail = (message: string): never => {
  console.error(`\n[FATAL] ${message}\n`);
  process.exit(1);
};

/** Read a Solana CLI JSON keypair file (a JSON array of 64 byte values). */
const readKeypairBytes = (path: string): Uint8Array => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return fail(
      `Could not read builder keypair at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!Array.isArray(raw) || raw.length !== 64) {
    return fail(
      `Keypair file ${path} must be a JSON array of exactly 64 bytes.`
    );
  }
  return Uint8Array.from(
    raw.map((v) => {
      if (typeof v !== "number" || v < 0 || v > 255 || !Number.isInteger(v)) {
        return fail(`Invalid byte in keypair file ${path}: ${String(v)}`);
      }
      return v;
    })
  );
};

/**
 * The Rise SDK's instruction builders return `InstructionsWithAccountsAndData`,
 * whose accounts are `{ address, role }` AccountMeta objects using the
 * `AccountRole` enum. That shape is already a valid `@solana/kit` Instruction,
 * so it can be appended to a transaction message directly. This helper just
 * narrows the type and pretty-prints the account list for the dry-run output.
 */
const describeIx = (label: string, ix: Instruction): void => {
  log(`\n${label}`);
  log(`  program: ${ix.programAddress}`);
  log(`  data:    ${ix.data ? ix.data.length : 0} bytes`);
  const accounts = (ix.accounts ?? []) as ReadonlyArray<{
    address: Address;
    role: AccountRole;
  }>;
  log(`  accounts (${accounts.length}):`);
  accounts.forEach((a, i) => {
    log(`    [${i}] ${a.address}  (${AccountRole[a.role]})`);
  });
};

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  hr();
  log("Phoenix Mobile — Flight builder registration");
  log(`Mode: ${EXECUTE ? "EXECUTE (transactions WILL be sent)" : "DRY-RUN"}`);
  hr();

  // ---- Load builder authority keypair -------------------------------------
  const builderSigner = await createKeyPairSignerFromBytes(
    readKeypairBytes(BUILDER_KEYPAIR_PATH)
  );
  const builderAuthority = builderSigner.address as Authority;

  log("\nConfiguration:");
  log(`  builder keypair path : ${BUILDER_KEYPAIR_PATH}`);
  log(`  builder authority    : ${builderAuthority}`);
  log(`  RPC URL              : ${RPC_URL}`);
  log(`  Phoenix API URL      : ${PHOENIX_API_URL}`);
  log(`  feeBps               : ${FEE_BPS} (${Number(FEE_BPS) / 100}%)`);
  log(`  builderPdaIndex      : ${BUILDER_PDA_INDEX}`);
  log(`  builderSubaccountIdx : ${BUILDER_SUBACCOUNT_INDEX}`);

  // ---- Guard rails --------------------------------------------------------
  if (FEE_BPS < 0n) fail("FEE_BPS cannot be negative.");
  if (FEE_BPS > 10_000n) {
    fail("FEE_BPS > 10000 (>100%) — refusing. Pick a sane value (e.g. 25).");
  }
  if (FEE_BPS > 100n) {
    log(
      `\n[WARN] FEE_BPS=${FEE_BPS} is unusually high (>1%). Double-check this ` +
        `is intentional before passing --execute.`
    );
  }
  if (BUILDER_PDA_INDEX < 0 || BUILDER_PDA_INDEX > 255) {
    fail("BUILDER_PDA_INDEX must be between 0 and 255.");
  }
  if (BUILDER_PDA_INDEX !== 0) {
    // The Rise SDK's buildRegisterTrader rejects non-zero traderPdaIndex.
    fail("BUILDER_PDA_INDEX must be 0 — non-zero is not supported by the SDK.");
  }
  if (BUILDER_SUBACCOUNT_INDEX < 0 || BUILDER_SUBACCOUNT_INDEX > 255) {
    fail("BUILDER_SUBACCOUNT_INDEX must be between 0 and 255.");
  }
  if (BUILDER_SUBACCOUNT_INDEX !== 0) {
    // Subaccount 0 is cross-margin; a fee-collector account should be 0.
    log(
      `\n[WARN] BUILDER_SUBACCOUNT_INDEX=${BUILDER_SUBACCOUNT_INDEX} is not 0. ` +
        `A builder fee-collector account is normally the cross-margin (0) ` +
        `account. Continue only if you know why.`
    );
  }

  // ---- Solana RPC + Phoenix client ----------------------------------------
  const rpc = createSolanaRpc(RPC_URL);

  // Flight is configured on the client so the SDK can also wrap order ixs
  // later; for registration we only need exchange metadata + ix builders.
  const client = createPhoenixClient({
    apiUrl: PHOENIX_API_URL,
    apiKey: process.env.PHOENIX_API_KEY,
    rpcUrl: RPC_URL,
    exchangeMetadata: { stream: false },
    flight: {
      builderAuthority,
      builderPdaIndex: BUILDER_PDA_INDEX,
      builderSubaccountIndex: BUILDER_SUBACCOUNT_INDEX,
    },
  });

  try {
    // Ensure exchange metadata is loaded (needed by buildRegisterTrader for
    // log-authority + global-configuration addresses).
    await client.exchange.ready();

    // ---- Derive the builder trader account PDA ----------------------------
    // This is the account that collects builder fees. It is owned by the
    // Phoenix program and derived from (authority, pdaIndex, subaccountIndex).
    const phoenixProgramAddress = client.pda.getProgramAddress();
    const builderTraderAccount = await client.pda.getTraderAddress({
      authority: builderAuthority,
      traderPdaIndex: BUILDER_PDA_INDEX,
      subaccountIndex: BUILDER_SUBACCOUNT_INDEX,
      phoenixProgramAddress,
    });

    // The Flight builder_state PDA created by register_builder.
    const flightBuilderStateAddress = await flight.getFlightBuilderStateAddress(
      builderAuthority,
      phoenixProgramAddress
    );
    const flightGlobalStateAddress = await flight.getFlightGlobalStateAddress(
      phoenixProgramAddress
    );

    log("\nDerived addresses:");
    log(`  Phoenix program        : ${phoenixProgramAddress}`);
    log(`  Flight program         : ${flight.FLIGHT_PROGRAM_ADDRESS}`);
    log(`  builder trader account : ${builderTraderAccount}`);
    log(`  Flight builder_state   : ${flightBuilderStateAddress}`);
    log(`  Flight global_state    : ${flightGlobalStateAddress}`);

    // ---- Check whether the builder trader account already exists ----------
    const traderAccountExists = await accountExists(rpc, builderTraderAccount);
    log(
      `\nBuilder trader account currently ${
        traderAccountExists ? "EXISTS — STEP 1 will be SKIPPED" : "does NOT exist"
      }.`
    );

    // =====================================================================
    // STEP 1 — Register the builder's Phoenix trader account
    // =====================================================================
    const step1Instructions: Instruction[] = [];
    if (!traderAccountExists) {
      log("\n[STEP 1] Building register-trader instruction...");

      // marginType Cross => cross-margin trader account (subaccount index 0).
      // The fee payer + authority is the builder wallet itself.
      const registerTraderIx = await client.ixs.buildRegisterTrader({
        authority: builderAuthority,
        marginType: MarginType.Cross,
        traderPdaIndex: BUILDER_PDA_INDEX,
        // traderSubaccountIndex is forced to 0 for cross margin by the SDK.
      });
      step1Instructions.push(registerTraderIx as unknown as Instruction);
      describeIx("[STEP 1] register_trader instruction", registerTraderIx as unknown as Instruction);
    } else {
      log("\n[STEP 1] Skipped — builder trader account already on-chain.");
    }

    // =====================================================================
    // STEP 2 — Register the builder authority as a Flight builder
    // =====================================================================
    log("\n[STEP 2] Building register-builder (Flight) instruction...");

    // buildRegisterBuilderIx derives global_state, builder_state, and the
    // trader account internally; we just hand it the authority + indexes + fee.
    // Account layout (from rust/ix/src/flight/register_builder.rs):
    //   [0] flight global_state   (readonly)
    //   [1] phoenix program       (readonly)
    //   [2] builder authority     (writable signer)  <- builderSigner
    //   [3] builder trader account(writable)
    //   [4] flight builder_state  (writable)
    //   [5] system program        (readonly)
    // Data: u8 traderPdaIndex | u8 traderSubaccountIndex | u64 feeBps
    const registerBuilderIx = await flight.buildRegisterBuilderIx({
      traderAuthority: builderAuthority,
      traderPdaIndex: BUILDER_PDA_INDEX,
      traderSubaccountIndex: BUILDER_SUBACCOUNT_INDEX,
      feeBps: FEE_BPS,
    });
    describeIx("[STEP 2] register_builder instruction", registerBuilderIx as unknown as Instruction);

    // =====================================================================
    // Assemble the transaction(s)
    // =====================================================================
    // We send STEP 1 and STEP 2 as SEPARATE transactions when STEP 1 is
    // needed: register_builder reads the builder trader account, which must
    // already exist and be committed before register_builder runs. Splitting
    // them avoids any intra-transaction ordering / account-state ambiguity.
    //
    // If the trader account already exists, only STEP 2 is sent.

    const transactions: Array<{
      label: string;
      instructions: Instruction[];
    }> = [];

    if (step1Instructions.length > 0) {
      transactions.push({
        label: "TX 1 — register builder Phoenix trader account",
        instructions: step1Instructions,
      });
    }
    transactions.push({
      label: `TX ${step1Instructions.length > 0 ? 2 : 1} — register Flight builder`,
      instructions: [registerBuilderIx as unknown as Instruction],
    });

    hr();
    if (!EXECUTE) {
      log("\nDRY-RUN: no transactions sent.");
      log("Simulating each transaction against RPC...\n");
      for (const tx of transactions) {
        await simulateTransaction(rpc, builderSigner, tx);
      }
      hr();
      log("\nDry-run complete. Review the output above.");
      log("Re-run with `--execute` to broadcast for real:");
      log("  tsx scripts/register-flight-builder.ts --execute");
      hr();
      return;
    }

    // ---- EXECUTE path -----------------------------------------------------
    log("\nEXECUTE mode: broadcasting transactions...\n");
    for (const tx of transactions) {
      const signature = await sendTransaction(rpc, builderSigner, tx);
      log(`  ${tx.label}`);
      log(`  -> confirmed: ${signature}`);
      log(`  -> https://explorer.solana.com/tx/${signature}\n`);
    }

    hr();
    log("Flight builder registration COMPLETE.");
    log(`  builder authority      : ${builderAuthority}`);
    log(`  builder trader account : ${builderTraderAccount}`);
    log(`  Flight builder_state   : ${flightBuilderStateAddress}`);
    log(`  feeBps                 : ${FEE_BPS}`);
    log("\nNext: configure the app's Phoenix client with");
    log("  flight: {");
    log(`    builderAuthority: "${builderAuthority}",`);
    log(`    builderPdaIndex: ${BUILDER_PDA_INDEX},`);
    log(`    builderSubaccountIndex: ${BUILDER_SUBACCOUNT_INDEX},`);
    log("  }");
    log("See scripts/FLIGHT-RUNBOOK.md for verification + fee withdrawal.");
    hr();
  } finally {
    client.dispose();
  }
}

// ============================================================================
// RPC helpers
// ============================================================================

/** Returns true if the account currently exists on-chain. */
async function accountExists(
  rpc: ReturnType<typeof createSolanaRpc>,
  account: Address
): Promise<boolean> {
  const result = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
  return result.value !== null;
}

/**
 * Build + sign a versioned (v0) transaction from a set of SDK instructions.
 * The builder wallet is both fee payer and the only signer.
 */
async function buildSignedTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  signer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>,
  instructions: Instruction[]
) {
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    // The builder authority is the fee payer. It is also the WRITABLE_SIGNER
    // account inside both register_trader and register_builder, so kit will
    // require its signature when we sign below.
    (tx) => setTransactionMessageFeePayer(signer.address, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );

  // VERIFY: `signTransactionMessageWithSigners` resolves signers attached to
  // the message. Because we set the fee payer with `setTransactionMessageFeePayer`
  // (address form, not signer form), we pass the signer explicitly here so the
  // builder authority's signature is produced. If your @solana/kit version
  // prefers `setTransactionMessageFeePayerSigner(signer, tx)`, switch to that
  // and drop the explicit signer arg below.
  const signed = await signTransactionMessageWithSigners(message, [signer]);
  return { signed, latestBlockhash };
}

/** Dry-run: build, sign, and simulate a transaction; print the result. */
async function simulateTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  signer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>,
  tx: { label: string; instructions: Instruction[] }
): Promise<void> {
  log(`[SIMULATE] ${tx.label}`);
  const { signed } = await buildSignedTransaction(rpc, signer, tx.instructions);
  const wire = getBase64EncodedWireTransaction(signed);

  const sim = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send();

  if (sim.value.err) {
    log(`  RESULT: FAILED — ${JSON.stringify(sim.value.err)}`);
    log("  --- simulation logs ---");
    for (const line of sim.value.logs ?? []) log(`  ${line}`);
    log(
      "  NOTE: a failure here usually means the builder is already registered, " +
        "or the wallet lacks SOL, or the trader account state is unexpected. " +
        "Inspect the logs above before retrying with --execute."
    );
  } else {
    log(`  RESULT: OK — would succeed`);
    log(`  compute units consumed: ${sim.value.unitsConsumed ?? "n/a"}`);
  }
  log("");
}

/** Execute: build, sign, send, and confirm a transaction; return signature. */
async function sendTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  signer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>,
  tx: { label: string; instructions: Instruction[] }
): Promise<string> {
  const { signed, latestBlockhash } = await buildSignedTransaction(
    rpc,
    signer,
    tx.instructions
  );
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);

  await rpc
    .sendTransaction(wire, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
    })
    .send();

  // Poll for confirmation against the blockhash's validity window.
  // VERIFY: `sendAndConfirmTransactionFactory` (from @solana/kit, needs an
  // RPC-subscriptions/websocket transport) is the higher-level alternative.
  // We poll over plain HTTP RPC here to avoid requiring a websocket endpoint.
  const lastValidBlockHeight = Number(latestBlockhash.lastValidBlockHeight);
  for (;;) {
    const status = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .send();
    const info = status.value[0];
    if (info) {
      if (info.err) {
        throw new Error(
          `${tx.label} failed on-chain: ${JSON.stringify(info.err)}`
        );
      }
      const c = info.confirmationStatus;
      if (c === "confirmed" || c === "finalized") return signature;
    }
    const { value: height } = await rpc.getBlockHeight().send();
    if (Number(height) > lastValidBlockHeight) {
      throw new Error(
        `${tx.label}: blockhash expired before confirmation (sig ${signature}). ` +
          `Re-run the script; if the trader account was created it will skip STEP 1.`
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// Suppress an unused-import lint for helpers that may be useful when adapting
// this script (kept intentionally; safe to remove if your linter complains).
void address;
void getBase58Decoder;

// ============================================================================
main().catch((error) => {
  console.error("\n[ERROR]", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
