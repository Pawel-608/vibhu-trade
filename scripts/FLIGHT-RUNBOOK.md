# Flight Builder Registration — Operator Runbook

This is a **one-time** operational procedure. It registers a builder authority
with Phoenix's **Flight** routing layer so that order flow from the Phoenix
Mobile app accrues **builder fees** to a trader account we control.

Once registered, configuring the app's Phoenix client with
`flight: { builderAuthority, ... }` makes supported order instructions
(limit + market) route through the Flight program and pay builder fees into the
builder's trader account.

> Run this **once** for the builder authority. After it succeeds you never run
> it again for that authority — you only change the fee with a separate
> `update_fee` instruction (not covered by this script).

---

## 1. What gets created

The registration is two on-chain steps:

| Step | Instruction                | Creates / does                                                      |
| ---- | -------------------------- | ------------------------------------------------------------------- |
| 1    | Phoenix `register_trader`  | The builder's Phoenix **trader account** PDA (the fee collector).   |
| 2    | Flight `register_builder`  | The Flight **`builder_state`** PDA, binding the authority + feeBps.  |

If the builder trader account already exists on-chain, Step 1 is skipped
automatically.

The script (`register-flight-builder.ts`) sends Step 1 and Step 2 as
**separate transactions** — `register_builder` reads the trader account, which
must be committed first.

---

## 2. Prerequisites

Before running anything:

1. **A dedicated builder wallet (keypair).**
   - This is the **builder authority**. It signs both transactions, pays rent
     and fees, and owns the trader account that collects builder fees.
   - Use a **dedicated** keypair — not a personal/team wallet, not the app's
     user wallets. Treat it as a production secret.
   - Format: a standard Solana CLI JSON keypair (a 64-byte JSON array), e.g.
     created with `solana-keygen new -o phoenix-flight-builder.json`.
   - Default path the script looks for:
     `~/.config/solana/phoenix-flight-builder.json`
     (override with `BUILDER_KEYPAIR_PATH`).

2. **SOL in the builder wallet** for rent + transaction fees.
   - The trader account and the Flight `builder_state` account are rent-exempt
     PDAs. Fund the wallet with a small buffer — **~0.05 SOL is plenty** for
     both account creations plus fees. Run the dry-run first; it reports the
     compute units and will fail clearly if the wallet is underfunded.

3. **A reliable RPC endpoint** (mainnet).
   - Public `api.mainnet-beta.solana.com` works for a one-off but can be rate
     limited. A private RPC is recommended. Set via `SOLANA_RPC_URL`.

4. **Node + tsx.**
   - The script runs with `tsx`. The repo already has `tsx`,
     `@ellipsis-labs/rise`, and `@solana/kit` as dependencies — just
     `npm install` (or your package manager) at the repo root if needed.

5. **Decide the builder authority pubkey in advance** and make sure whoever
   later withdraws fees has access to that wallet.

---

## 3. Choosing `feeBps`

`feeBps` is the builder fee in **basis points** (1 bps = 0.01%). It is charged
on Flight-routed order flow and is encoded on-chain as a `u64`.

Guidance:

- **Start conservative.** `25` bps (0.25%) is a reasonable default and the
  value used in the Rise SDK examples.
- This fee is **on top of** Phoenix's own taker fee, so it directly affects the
  cost users pay. Higher = more revenue per trade but worse pricing for users.
- `0` is allowed (register as a builder but take no fee).
- The script **refuses** values `> 10000` (>100%) and **warns** above `100`
  bps (>1%). If you genuinely want a high fee, you'll see the warning in
  dry-run before anything is sent.
- The fee can be changed later via the Flight `update_fee` instruction (the
  Rise SDK exposes `flight` update-fee builders) — it does **not** require
  re-running this registration.

Set it via the `FEE_BPS` env var or the `FEE_BPS` constant at the top of
`register-flight-builder.ts`.

---

## 4. Run the dry-run (always do this first)

The script **defaults to dry-run**. It builds the instructions, derives every
PDA, signs the transactions, and **simulates** them against RPC — but sends
nothing.

```bash
# from the phoenix-mobile repo root
BUILDER_KEYPAIR_PATH=~/.config/solana/phoenix-flight-builder.json \
SOLANA_RPC_URL=https://your-rpc-endpoint \
FEE_BPS=25 \
BUILDER_PDA_INDEX=0 \
BUILDER_SUBACCOUNT_INDEX=0 \
tsx scripts/register-flight-builder.ts
```

(You can also just edit the constants at the top of the script and run
`tsx scripts/register-flight-builder.ts` with no env vars.)

Review the output carefully:

- **Builder authority** — confirm it is the wallet you intend.
- **Builder trader account** — the fee-collecting PDA.
- **Flight `builder_state`** address.
- **feeBps** — confirm the value and the percentage shown.
- Whether **Step 1 will run or be skipped** (depends on whether the trader
  account already exists).
- Each transaction's simulation result must say **`RESULT: OK`**.

If a simulation says `FAILED`, read the logs printed beneath it. Common causes:
the builder is already registered, the wallet has insufficient SOL, or the
trader-account state is unexpected. **Do not proceed to `--execute` until the
dry-run is clean.**

---

## 5. Execute

Once the dry-run is clean, re-run with the explicit `--execute` flag:

```bash
BUILDER_KEYPAIR_PATH=~/.config/solana/phoenix-flight-builder.json \
SOLANA_RPC_URL=https://your-rpc-endpoint \
FEE_BPS=25 \
tsx scripts/register-flight-builder.ts --execute
```

The script will:

1. Send **TX 1** (`register_trader`) if the trader account does not exist, and
   wait for confirmation.
2. Send **TX 2** (`register_builder`) and wait for confirmation.
3. Print the confirmed signatures and Solana Explorer links.

If a transaction's blockhash expires before confirmation, the script errors
out — simply **re-run it**. It is safe to re-run: Step 1 is skipped if the
trader account already exists.

---

## 6. Verify success

After `--execute` finishes:

1. **Transaction signatures.** Open each Explorer link the script printed and
   confirm both transactions succeeded.

2. **Builder `builder_state` account exists.** Check the Flight
   `builder_state` address from the script output on Explorer — it should now
   be an account owned by the Flight program
   (`F1ightu9cujFYo34k9CabifLrJT8qzfDVM2Q7BqhJn2W`).

3. **Re-run the dry-run.** Run the script again **without** `--execute`. It
   should now report:
   - "Builder trader account currently EXISTS — STEP 1 will be SKIPPED".
   - The `register_builder` simulation will likely now **fail** with an
     "already registered" style error — that is the expected confirmation
     that registration is in place. (Do **not** run `--execute` again.)

4. **End-to-end check.** Configure a Phoenix client with the `flight` block and
   build a market order; the resulting instruction's `programAddress` should
   equal the Flight program address
   (`flight.FLIGHT_PROGRAM_ADDRESS`), confirming order flow is now routed:

   ```ts
   import { createPhoenixClient, flight } from "@ellipsis-labs/rise";

   const client = createPhoenixClient({
     apiUrl: "https://perp-api.phoenix.trade",
     rpcUrl: "https://api.mainnet-beta.solana.com",
     flight: {
       builderAuthority: "<BUILDER_AUTHORITY>",
       builderPdaIndex: 0,
       builderSubaccountIndex: 0,
     },
   });
   // ...build a market order ix...
   console.log(ix.programAddress === flight.FLIGHT_PROGRAM_ADDRESS); // true
   ```

---

## 7. Wire the app up to Flight

After registration, the app must be configured so its Phoenix client routes
orders through Flight. In the app code (owned by another agent), the Phoenix
client should be created with:

```ts
flight: {
  builderAuthority: "<BUILDER_AUTHORITY_PUBKEY>",
  builderPdaIndex: 0,
  builderSubaccountIndex: 0,
}
```

With `flight` configured, the Rise SDK automatically wraps supported order
instructions (`placeLimitOrder` / `placeMarketOrder` and their `buildPlace*`
variants) as Flight proxy instructions. Post-only orders remain native Phoenix
instructions and are **not** Flight-routed.

> **Use embedded wallets per user for Flight integrations.** The Rise docs
> strongly recommend provisioning an embedded wallet per user rather than
> routing Flight orders through users' raw external wallets, so per-integration
> trader state stays isolated.

---

## 8. How builder fees are withdrawn

Builder fees from all Flight-routed orders accrue to the **builder's trader
account** (the fee-collector PDA derived from the builder authority +
`builderPdaIndex` + `builderSubaccountIndex`).

Per the Rise SDK README ("Flight Builder Activation and Routed Orders"):

> When you register Flight against a builder authority and its associated
> trader account, all builder fees from Flight-routed orders accrue to that
> builder trader account. **Those fees are withdrawable from the Phoenix
> frontend.**

So to collect accrued builder fees:

1. Connect the **builder authority wallet** to the Phoenix frontend.
2. The builder's trader account will show the accrued builder-fee balance as
   collateral.
3. Withdraw it from the frontend like any other trader collateral balance.

There is no separate "claim builder fees" instruction in this tooling — fees
land in the trader account and are withdrawn through the normal Phoenix
withdraw flow with the builder authority as signer.

---

## 9. Quick reference — environment variables

| Variable                  | Default                                          | Purpose                                  |
| ------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `BUILDER_KEYPAIR_PATH`    | `~/.config/solana/phoenix-flight-builder.json`   | Builder authority keypair (JSON array).  |
| `SOLANA_RPC_URL`          | `https://api.mainnet-beta.solana.com`            | Solana RPC endpoint.                     |
| `PHOENIX_API_URL`         | `https://perp-api.phoenix.trade`                 | Phoenix API (exchange metadata).         |
| `PHOENIX_API_KEY`         | _(unset)_                                        | Optional Phoenix API key.                |
| `FEE_BPS`                 | `25`                                             | Builder fee in basis points (u64).       |
| `BUILDER_PDA_INDEX`       | `0`                                              | Trader PDA index (must be 0).            |
| `BUILDER_SUBACCOUNT_INDEX`| `0`                                              | Subaccount index (0 = cross-margin).     |

CLI flag:

- _(no flag)_ → **dry-run** (build + simulate, send nothing).
- `--execute` → broadcast the transactions.
