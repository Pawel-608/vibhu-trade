# CONTRACTS — feature-agent coordination

This skeleton establishes every **shared contract** for Phoenix Mobile so that
four feature agents can work in parallel on **non-overlapping directories**
without ever touching a shared file.

Read this before writing any code. See `PLAN.md` for the product plan.

---

## 1. The golden rule

> **Feature agents create and edit files ONLY within their owned directory.
> Never edit `package.json`, configs, providers, routes, or shared `src/lib`,
> `src/types`, `src/components` files.**

If you need a new dependency, a new shared type, a new provider, or a new route,
**stop and request it** — do not add it yourself. Those are skeleton-owned and
changing them creates merge conflicts across agents.

---

## 2. Directory ownership map

| Directory                | Owner agent          | Scope                                                   |
| ------------------------ | -------------------- | ------------------------------------------------------- |
| `src/market-data/`       | **Market Data**      | Market selector, market header, chart, orderbook, trades feed, the "Markets" view. |
| `src/trading/`           | **Trading**          | Order entry, open orders, positions, the "Trade" view, transaction submit helper. |
| `src/auth/` + `src/wallet/` | **Auth & Wallet** | Login screen, onboarding flow, the `AppWallet` abstraction and `useWallet()` implementations. |
| `src/account/`           | **Account**          | Account view, collateral deposit/withdraw.              |

Each agent owns **all files** (existing stubs + any new files) inside its
directory. A feature agent may add sub-directories, hooks, stores, and helpers
**within** its owned directory freely.

### Shared / off-limits (skeleton-owned — do NOT edit)

```
package.json  package-lock.json  next.config.mjs  tsconfig.json
tailwind.config.ts  postcss.config.mjs  .eslintrc.json  .env.example
app/**                         all routes + layout + globals.css
src/providers/**                AppProviders, Query/Privy/RiseClient providers
src/lib/**                      constants, format, cn
src/types/**                    shared app types
src/components/**               app-shell: BottomNav, TradeScreen, StubPanel,
                                ServiceWorkerRegistrar
public/**                       manifest, icons, service worker
PLAN.md  API-RECON.md  CONTRACTS.md
```

---

## 3. Shared contracts you can rely on

### Providers (mounted by `app/layout.tsx` via `AppProviders`)

| Import                                         | Gives you                                              |
| ---------------------------------------------- | ------------------------------------------------------ |
| `usePhoenixClient()` — `@/providers/RiseClientProvider` | The Rise SDK `PhoenixClient`. Use `client.api.*` for one-shot HTTP reads, `client.streams` / `client.marketData()` / `client.orderbooks()` for live data, `client.ixs` / `client.orderPackets` for tx building. |
| `QueryProvider` (TanStack Query) is already mounted | Wrap one-shot HTTP reads in `useQuery`. Live data uses the SDK's Zustand stores directly — **not** React Query. |
| `PrivyAuthProvider` is already mounted          | `@privy-io/react-auth` hooks (`usePrivy`, `useWallets`, etc.) are available app-wide. Active only when `NEXT_PUBLIC_PRIVY_APP_ID` is set. |

### Wallet (`src/wallet/` — owned by Auth & Wallet, consumed by everyone)

| Import                                  | Gives you                                              |
| --------------------------------------- | ------------------------------------------------------ |
| `useWallet()` — `@/wallet/WalletProvider` | `{ wallet, isConnecting, connectPrivy, connectExternal, disconnect }`. |
| `AppWallet` — `@/wallet/types`          | `{ kind, authority, isConnected, signTransaction, loginToRise }`. |

Other agents **consume** `useWallet()` / `AppWallet`; only the Auth & Wallet
agent **implements** them.

### Shared lib & types

| Import                              | Gives you                                              |
| ----------------------------------- | ------------------------------------------------------ |
| `@/lib/constants`                   | `PHOENIX_API_URL`, `SOLANA_RPC_URL`, `PRIVY_APP_ID`, `PRIVY_ENABLED`, `DEFAULT_SYMBOL`, `tradeRoute()`, `TRADE_VIEWS`, Flight placeholders. |
| `@/lib/format`                      | bigint-safe display formatters: `formatScaled`, `formatPrice`, `formatSize`, `formatUsd`, `formatPercentFromBps`, `shortenAddress`, … **No floats in trading math.** |
| `@/lib/cn`                          | `cn(...)` — clsx + tailwind-merge class helper.        |
| `@/types`                           | `TradeView`, `Side`, `OrderType`, `MarginMode`, `MarketSummary`, `LoadStatus`, `AppToast`, `TxResult`. |
| `@/components/StubPanel`            | `<StubPanel label hint />` — the TODO placeholder; keep using it for sub-areas not yet built. |

For Rise SDK wire types (API/WS payloads), import directly from
`@ellipsis-labs/rise` — do not re-declare them in `src/types`.

### Routing & app shell

- The main screen is `app/trade/[symbol]/page.tsx` → `<TradeScreen>`.
- **Markets / Trade / Account are in-page view toggles**, not routes — managed
  by `src/components/TradeScreen.tsx` + `BottomNav.tsx`. Do not add routes for
  them.
- `TradeScreen` already wires the four feature views:
  `MarketDataView` (market-data), `TradeView` (trading), `AccountView`
  (account), and `MarketSelector` (market-data) for the header overlay.
- Switching market = `router.push(tradeRoute(symbol))`.

If a feature genuinely needs a new route or a change to `TradeScreen`, request
it from the skeleton owner.

---

## 4. Cross-feature dependencies (allowed imports)

These are the only sanctioned cross-directory imports between feature agents:

- **Market Data → Trading**: the data row in `MarketDataView` may render the
  Trading agent's `Positions` / `OpenOrders`. Import them from `@/trading/…`.
- **Account → Trading**: `CollateralActions` submits via the Trading agent's
  `submitTransaction` from `@/trading/submitTransaction`.
- **Everyone → Auth & Wallet**: `useWallet()` for `authority` + signing.

Keep these as the public surface; do not deep-import another agent's internals.

---

## 5. Stub status

Every file listed under §2 ownership currently renders a labelled `TODO`
placeholder (via `StubPanel` or inline). Each stub file begins with a comment
block describing its intended **props, Rise SDK calls, and stores/streams**.
Replace the stub bodies with real implementations; keep the exported component
names and prop names stable so the shell keeps compiling.

---

## 6. Open blockers (Phase 0 — see PLAN.md §8 / §11)

| Blocker | Status / mitigation |
| --- | --- |
| **`@ellipsis-labs/rise@0.4.9` install** | ✅ **Resolved.** Published to npm and installs cleanly. No type shim was needed — the skeleton type-checks against the real SDK. |
| **Privy domain allowlist** | Not arranged. App runs the **external-wallet fallback** when `NEXT_PUBLIC_PRIVY_APP_ID` is blank (`PRIVY_ENABLED === false`). Flip to Privy-primary once allowlisted. |
| **Privy optional Solana peer deps** | Privy 3.x statically imports `@solana-program/{system,token,memo}`. Pinned to versions compatible with `@solana/kit` v4 (`system@0.8.1`, `token@0.7.0`, `memo@0.8.0`) and an `overrides` block forces their `@solana/kit` peer to the root v4. `@farcaster/mini-app-solana` (optional, unused) is marked external in `next.config.mjs`. **Do not bump these without re-checking the kit-v4 constraint** — newer releases require kit v6 and break the build. |
| **Solana RPC** | `NEXT_PUBLIC_SOLANA_RPC_URL` is empty by default; the SDK falls back to its own default. Production needs a paid RPC behind an `/api/rpc` proxy (PLAN.md §3) — route not yet created. |
| **Flight builder** | `FLIGHT_*` values in `src/lib/constants.ts` are placeholders; the builder must be registered (PLAN.md §5) and `RiseClientProvider` updated with the `flight` config. Owned by the skeleton + `scripts/` agent. |
| **Phoenix perps program ID** | `PHOENIX_PROGRAM_ID_PLACEHOLDER` is the legacy *spot* program — display-only placeholder. Confirm the mainnet perps program ID. |

---

## 7. Verification

The skeleton was verified with:

```
npm install      # ✅ clean, no peer-dep errors
npx tsc --noEmit # ✅ passes
npm run build    # ✅ passes, no warnings — 6 routes generated
```

Keep all three green. Run `npm run typecheck` before considering any feature
work done.
