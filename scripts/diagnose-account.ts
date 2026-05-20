/**
 * Diagnostic — reproduce the "open account" transactions for a wallet and dump
 * the Solana program logs, without needing the user's private key.
 *
 *   tsx scripts/diagnose-account.ts [WALLET_PUBKEY]
 *
 * Builds each candidate instruction via the Rise SDK, assembles a transaction,
 * and SIMULATES it (sigVerify:false, replaceRecentBlockhash:true) so the RPC
 * returns the program logs that pinpoint the failing account.
 */
import process from "node:process";

import {
  createPhoenixClient,
  MarginType,
  OrderFlags,
  symbol as toSymbol,
  type Authority,
} from "@ellipsis-labs/rise";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

const AUTHORITY =
  process.argv[2] ?? "9zsnLLjc1MexE1T3qLnP5pvnJ9gigfXZ4z4jfFU1BuGv";
const API_URL =
  process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";
const RPC_URL = process.env.SOLANA_RPC_URL;

const log = (...a: unknown[]) => console.log(...a);
const hr = () => log("-".repeat(64));

/** Raw JSON-RPC POST — avoids kit's RPC client (which can't serialize BigInt). */
async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL as string, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: unknown };
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result as T;
}

/** Assemble a tx from the given instructions and simulate it; print logs. */
async function simulate(label: string, ixs: Instruction[]): Promise<void> {
  hr();
  log(`SIMULATE ${label}  (${ixs.length} instruction(s))`);

  const bh = await rpcCall<{
    value: { blockhash: string; lastValidBlockHeight: number };
  }>("getLatestBlockhash", [{ commitment: "confirmed" }]);

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (t) => setTransactionMessageFeePayer(address(AUTHORITY), t),
    (t) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: bh.value.blockhash as Blockhash,
          lastValidBlockHeight: BigInt(bh.value.lastValidBlockHeight),
        },
        t,
      ),
    (t) => appendTransactionMessageInstructions(ixs, t),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));

  const sim = await rpcCall<{
    value: { err: unknown; logs: string[] | null };
  }>("simulateTransaction", [
    wire,
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    },
  ]);

  log(`  err: ${JSON.stringify(sim.value.err)}`);
  log("  --- program logs ---");
  for (const line of sim.value.logs ?? []) log("  ", line);
}

async function main(): Promise<void> {
  if (!RPC_URL) {
    console.error("SOLANA_RPC_URL is not set in the environment.");
    process.exit(1);
  }

  log("Authority :", AUTHORITY);
  log("RPC       :", RPC_URL.replace(/api[-_]?key=[^&]+/i, "api_key=***"));

  const client = createPhoenixClient({ apiUrl: API_URL, rpcUrl: RPC_URL });
  await client.exchange.ready();

  hr();
  try {
    const wl = await client.api.invite().checkWallet(AUTHORITY);
    log("checkWallet:", JSON.stringify(wl));
  } catch (e) {
    log("checkWallet FAILED:", (e as Error).message);
  }

  // Register-trader.
  try {
    const ix = (await client.ixs.buildRegisterTrader({
      authority: AUTHORITY as Authority,
      marginType: MarginType.Cross,
    })) as unknown as Instruction;
    await simulate("register-trader", [ix]);
  } catch (e) {
    hr();
    log("register-trader: skipped —", (e as Error).message);
  }

  // Deposit 1 USDC of collateral — the FULL flow (createAta + ember + deposit).
  try {
    const flow = await client.ixs.buildDepositIxs({
      authority: AUTHORITY as Authority,
      amount: 1_000_000n,
      traderPdaIndex: 0,
    });
    await simulate(
      "deposit 1 USDC (buildDepositIxs flow)",
      flow.instructions as unknown as Instruction[],
    );
  } catch (e) {
    hr();
    log("deposit: failed —", (e as Error).message);
  }

  // Small SOL market order.
  try {
    const orderPacket = await client.orderPackets.buildMarketOrderPacket({
      symbol: "SOL",
      side: 0,
      baseUnits: "0.1",
      orderFlags: OrderFlags.None,
    });
    const ix = (await client.ixs.buildPlaceMarketOrder({
      authority: AUTHORITY as Authority,
      symbol: toSymbol("SOL"),
      orderPacket,
      traderPdaIndex: 0,
    })) as unknown as Instruction;
    await simulate("place SOL market order", [ix]);
  } catch (e) {
    hr();
    log("market order: failed —", (e as Error).message);
  }

  client.dispose();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
