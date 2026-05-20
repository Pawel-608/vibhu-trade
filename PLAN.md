# Phoenix Mobile — Implementation Plan

A mobile-first web app (installable PWA) for trading **Phoenix perpetual futures**.

---

## 1. Repo analysis — what we build on

The `perps/` workspace contains 15 repos. They split cleanly into two products:

### Phoenix Legacy (spot) — NOT used by this project
`phoenix-v1`, `phoenix-sdk`, `phoenix-cli`, `phoenixpy`, `jupiter-phoenix`,
`phoenix-seat-manager-v1`, `phoenix-onchain-market-maker`, `sokoban`,
`sokoban-bindings`, `ellipsis-client`, `ellipsis-macros`.

These implement the **on-chain spot orderbook DEX** (program
`PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`). A spot frontend would read
on-chain accounts directly via `@ellipsis-labs/phoenix-sdk`. **Not our target.**

### Phoenix Perps — our foundation
- **`rise-public`** — the `@ellipsis-labs/rise` SDK (v0.4.9). The developer
  surface for Phoenix perps. This is the **core dependency** of the mobile app.
- **`vulcan-cli`** — an AI/CLI trading client for Phoenix perps. Not a code
  dependency, but the **best reference for feature scope and trader UX** (account,
  margin, positions, orders, TWAP/grid strategies, paper trading).

### Why `rise-public` is the right base
It is a hosted-API SDK, not a raw on-chain SDK — exactly what a mobile web app
wants:
- **HTTP API** (`https://perp-api.phoenix.trade`) — exchange/market/orderbook/
  trader snapshots, candles, funding, trade & order history, PnL.
- **Typed WebSocket streams** — `l2Book`, `fills`, `candles`, `markPrice`,
  `allMids`, `traderState`, `marketStats`, `fundingRate`, `notifications`.
- **Instruction builders** (`client.ixs`, `client.orderPackets`) returning
  `@solana/kit` instructions for limit/market/conditional orders, cancels,
  collateral, trader registration.
- **Flight** — builder-fee routing layer (auto-wraps order instructions).
- **Auth** — `loginWithPrivyToken` / `loginWithWalletSignature`, session
  management with browser `localStorage` persistence.
- Ships **Zustand-backed live stores** (`createTraderStateStore`,
  `createPhoenixMarketData`, `createPhoenixOrderbookManager`) and documents
  React usage — it is built to back a frontend.
- The SDK reads `NEXT_PUBLIC_SOLANA_RPC_URL` — it **expects a Next.js host**.

---

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Auth / wallet | **Privy social login**, sharing Phoenix's Privy app (same login → same embedded wallet → same Phoenix account as `phoenix.trade`). |
| v1 scope | **Trade-first, lean** — markets, chart + orderbook, market & limit orders, positions, collateral deposit/withdraw. |
| Order routing | **Flight** — register as a builder; orders route through Flight so builder fees accrue to our trader account. |
| Privy domain allowlist | **Not yet arranged** — treated as a blocking dependency with an external-wallet fallback. |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Phoenix Mobile  (Next.js App Router PWA)                │
│                                                          │
│  UI (React + Tailwind, mobile-first, bottom-sheet UX)    │
│       │                                                  │
│  Wallet abstraction  ──►  Privy embedded wallet          │
│       │                   (fallback: external adapter)   │
│  Rise client provider (createPhoenixClient)              │
│       │            │                │                   │
│   HTTP API      WS streams      ixs / orderPackets       │
└───────┼────────────┼────────────────┼───────────────────┘
        │            │                │
   perp-api.phoenix.trade        Solana RPC (via /api proxy)
   (REST + WSS)                  + Phoenix program / Flight
```

### Tech stack
- **Next.js (App Router) + TypeScript** — PWA host; API routes proxy the paid
  RPC key and (optionally) verify Privy tokens server-side. SDK already targets
  `NEXT_PUBLIC_SOLANA_RPC_URL`.
- **Tailwind CSS** — mobile-first styling; design system tuned for one-handed use.
- **`@ellipsis-labs/rise`** — data + trading layer (pin to `0.4.9`; it is
  pre-1.0, API may move). May need `transpilePackages: ["@ellipsis-labs/rise"]`
  since it ships pure ESM.
- **`@privy-io/react-auth`** (with Solana) — auth + embedded wallet.
- **`@solana/kit` v4** — transaction assembly (the SDK builds `kit`
  instructions). Already a transitive dep of `rise`.
- **TanStack Query** — caching one-shot HTTP reads. Live data uses the SDK's
  Zustand stores directly.
- **TradingView `lightweight-charts`** — candlestick chart, fed by the candles
  HTTP endpoint + WS `candles()` stream.
- **`next-pwa`** (or hand-rolled service worker) — installability + offline shell.

### Data-flow rules
- **One-shot reads** (market list, history, trader snapshot) → HTTP via
  `client.api.*`, cached with TanStack Query.
- **Live data** (orderbook, mids, mark price, candles, trader state) → WS via
  `client.streams.*`, surfaced through the SDK's Zustand stores. Use **leaf
  selectors** in components to avoid re-render storms (per SDK README).
- **Sending transactions** → build with `client.ixs` → assemble a `@solana/kit`
  transaction → sign with the wallet → submit through our RPC proxy →
  confirm via RPC websocket.

### Performance & rendering (from mobile trading-app research)
- **Batch WS updates** — buffer inbound stream messages and flush on
  `requestAnimationFrame`; never `setState` per message. Target >50 FPS during
  bursts.
- **Virtualize long lists** — `react-window` for orderbook, market selector,
  positions, history (visible rows only).
- **Web Worker** (optional, if mobile CPUs struggle) — parse/aggregate the
  message firehose off the main thread.
- **Leaf selectors** on the SDK's Zustand stores so a price tick re-renders one
  cell, not a tree.
- **No floats** — keep all math in the SDK's `bigint` lots/ticks domain; format
  only at the display edge.

---

## 4. Auth & wallet design

The Phoenix perps backend verifies Privy JWTs against **one specific Privy app**
(the one `phoenix.trade` uses). Using the **same Privy app ID** is what makes
"same login → same embedded wallet → same Phoenix account" work — and it is the
*only* way to authenticate against `perp-api.phoenix.trade` with a Privy
identity.

### Wallet abstraction
Define a single interface so the app is wallet-agnostic:

```ts
interface AppWallet {
  authority: string;                       // Solana pubkey
  signTransaction(tx): Promise<Signed>;
  loginToRise(): Promise<AuthSession>;      // mints a Rise session
}
```

Two implementations:
1. **Privy embedded wallet (primary / goal).** `@privy-io/react-auth` social
   login → `getAccessToken()` → `client.auth.loginWithPrivyToken(jwt)`. Embedded
   Solana wallet signs transactions. **Requires** the mobile domain on Phoenix's
   Privy allowlist (dashboard access by the Ellipsis team).
2. **External wallet adapter (interim / fallback).** Standard Solana wallet →
   `client.auth.getWalletNonce()` → sign message → `loginWithWalletSignature()`.
   Works with **no Phoenix cooperation**, but produces a *different* trader
   account than the user's `phoenix.trade` Privy account.

### Sequencing
- Ship the **external-wallet path first** (unblocked) so v1 can trade.
- Build the **Privy path in parallel**, behind a flag; flip it to primary the
  moment the domain is allowlisted.
- If the app is deployed on a **`phoenix.trade` subdomain**, Privy's session
  cookie is shared → true SSO (user arrives already logged in). On a separate
  domain, one extra login, same account.

### Rise session lifecycle
`loginWith*` returns `{ access_token, refresh_token, pop_key }`. Configure
`createPhoenixClient({ auth: true, authConfig: { storage:
new auth.LocalStorageAuthSessionStorage() } })` so the SDK auto-attaches the
bearer token, auto-refreshes (`/v1/auth/refresh`), and authenticates WS
subscriptions. Re-mint from a fresh Privy/wallet login when the refresh expires.

---

## 5. Flight builder setup (one-time, pre-work)

To earn builder fees:
1. Choose a **builder authority** keypair (a dedicated wallet).
2. Register its Phoenix trader account — `client.ixs.buildRegisterTrader(...)`.
3. Register the builder — `flight.buildRegisterBuilderIx({ traderAuthority,
   traderPdaIndex, traderSubaccountIndex, feeBps })`. Decide `feeBps`.
4. In the app, configure `createPhoenixClient({ flight: { builderAuthority,
   builderPdaIndex, builderSubaccountIndex } })`. Order instructions then
   **auto-wrap** through the Flight program.
5. Builder fees accrue to the builder trader account, withdrawable from the
   Phoenix frontend.

Do this as a small standalone script (TS `rise` SDK or `rise/rust`). The SDK
docs strongly recommend **embedded wallets** for Flight integrations to keep
per-user trader state isolated — another reason Privy is the target.

---

## 6. Feature scope

### v1 — Trade-first, lean
- Markets list: symbols, mark price, 24h change, funding rate; search & sort.
- Market detail: candlestick chart, L2 orderbook, price/mark/funding header,
  recent fills.
- Order ticket (bottom sheet): **market** & **limit** orders, size in base or
  quote units, leverage, margin type (cross / isolated), side.
- Positions: live list with size, entry, mark, liq price, uPnL, account health.
- Open orders: list + cancel (cancel-by-id, cancel-all).
- Collateral: deposit / withdraw.
- Onboarding: login → (invite activation if required) → trader registration.

### v2 — deferred
- Conditional orders: stop-loss, take-profit, brackets.
- Funding rate history, user funding history.
- PnL & portfolio-value charts, trade & order history.
- Notifications (WS `notifications` channel) + push.
- Price alerts; paper-trading mode (cf. `vulcan-cli`).

### Onboarding note — invite gating
Phoenix perps is invite-gated. The Rise SDK exposes `client.invite()` —
`activateInvite({ authority, code })` (access code) and
`activateInviteWithReferral({ authority, referral_code })`. v1 must handle the
**not-yet-activated** state and provide an activation screen. Confirm during
pre-work whether mainnet still requires this.

---

## 7. Screens & navigation  (informed by a mobile UX study of Hyperliquid)

A walkthrough of the Hyperliquid mobile web app (screenshots captured) shows
the proven perps-on-mobile pattern: **one trade screen is the hub**, a
**3-item bottom nav toggles views** (not routed pages), and **market switching
is a header dropdown**, not a nav item.

**Bottom nav — view toggles within the active market:**
**Markets · Trade · Account**
- *Markets* — market-data view: Chart / Order Book / Trades tabs + a data row
  (Positions / Open Orders / Trade History / Funding History).
- *Trade* — order-entry view: order type, margin (cross/isolated), leverage,
  Buy-Long / Sell-Short, price, size (with % slider), reduce-only, and a live
  Liquidation Price / Order Value / Margin Required summary.
- *Account* — equity, balances, Deposit / Withdraw.

**Market switching** — tap the market header (symbol + chevron) → full-screen
**market selector**: search, category tabs, sortable list with mark price,
24h change, volume.

**Secondary nav** — slide-out hamburger menu for Portfolio, history,
referrals, settings, logout.

**Screen inventory (v1):**
1. Login / splash — Privy social login (external-wallet fallback).
2. Onboarding — invite activation (if required) → trader registration.
3. Market selector — searchable/sortable; live mids via WS `allMids()`.
4. Markets view — chart + orderbook + trades, market header.
5. Order entry — market & limit orders, leverage, margin type (TP/SL → v2).
6. Positions — open positions, account health, close-position action.
7. Open orders — list + cancel.
8. Account — collateral deposit/withdraw, balances, settings, logout.

Mobile UX: thumb-zone tap targets, optimistic tx status with toasts, skeleton
loaders, pull-to-refresh. Order entry as a full-height view (Hyperliquid's
choice) or an expandable bottom sheet — settle in design.

---

## 8. Milestones

### Phase 0 — Foundations & spikes (pre-work, partly blocking)
- [ ] Confirm `@ellipsis-labs/rise@0.4.9` installs from npm (else vendor it).
- [ ] Provision a production Solana RPC (HTTP + WSS) for mainnet.
- [ ] Read Phoenix's **Privy app ID** from the `phoenix.trade` bundle; open the
      **domain-allowlist** request with the Ellipsis team. *(Blocking for Privy.)*
- [ ] Decide deployment domain (ideally a `phoenix.trade` subdomain for SSO).
- [ ] **Spike:** Privy embedded Solana wallet signing a `@solana/kit`
      transaction — resolve any `kit` ↔ Privy bridging.
- [ ] Flight: create builder authority, register builder trader + builder.
- [ ] Confirm mainnet invite-gating status and access-code flow.

### Phase 1 — Skeleton & data layer
- [ ] Next.js App Router + TS + Tailwind; PWA manifest + service worker.
- [ ] RPC proxy API route (hides the paid RPC key).
- [ ] Rise client React provider — `createPhoenixClient` (apiUrl, rpcUrl, ws,
      flight, auth).
- [ ] Markets list (HTTP snapshot + WS `allMids`).
- [ ] Market detail: chart (candles HTTP + WS), orderbook (WS `l2Book`),
      market stats / funding header.

### Phase 2 — Auth & wallet
- [ ] Wallet abstraction interface.
- [ ] External-wallet path (`getWalletNonce` → sign → `loginWithWalletSignature`).
- [ ] Privy integration (`@privy-io/react-auth`, Solana) →
      `loginWithPrivyToken`; behind a feature flag until allowlisted.
- [ ] Invite-activation onboarding flow.
- [ ] Trader registration (`buildRegisterTrader`) on first use.

### Phase 3 — Trading
- [ ] Order ticket UI (market & limit, size, leverage, margin type, side).
- [ ] Build order packets (`client.orderPackets`) + instructions (`client.ixs`,
      Flight-wrapped).
- [ ] Transaction assembly → sign → submit → confirm; status toasts.
- [ ] Open orders list + cancel (by-id, all).
- [ ] Positions view (WS `traderState`) + close position.
- [ ] Collateral deposit / withdraw.

### Phase 4 — Polish & PWA
- [ ] Mobile UX polish, gestures, bottom sheets, skeletons.
- [ ] Error handling, retry, rate-limit handling, tx failure surfaces.
- [ ] PWA install prompt, offline shell, app icons/splash.
- [ ] Performance: leaf selectors, code splitting, WS lifecycle tuning.
- [ ] Device QA (iOS Safari, Android Chrome); beta release.

### Phase 5 — v2
Conditional orders, funding/PnL analytics, history, notifications/push, alerts.

---

## 9. Suggested project structure

```
phoenix-mobile/
  app/                      # Next.js App Router
    (auth)/login/
    markets/
    markets/[symbol]/       # trade screen
    positions/
    orders/
    account/
    api/rpc/                # RPC proxy route
  src/
    rise/                   # createPhoenixClient provider, hooks
    wallet/                 # AppWallet abstraction, Privy + external impls
    trading/                # order ticket, tx assembly/submit/confirm
    market-data/            # chart, orderbook, hooks over SDK stores
    components/              ui/  hooks/  lib/
  public/                   # PWA manifest, icons
  scripts/flight-register.ts
```

---

## 10. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Privy domain allowlist not arranged | Ship external-wallet path first; flip Privy to primary once allowlisted. Pursue allowlisting in Phase 0. |
| `@solana/kit` v4 ↔ Privy signing friction | Dedicated Phase 0 spike before committing to the flow. |
| `rise` SDK is pre-1.0 (0.4.9) | Pin the version; isolate all SDK calls behind our own thin wrappers. |
| ESM-only SDK in Next | `transpilePackages` / ESM config; verify in Phase 1. |
| Invite-gating blocks new users | Build the activation flow; confirm mainnet requirement in Phase 0. |
| Paid RPC key exposure / rate limits | Server-side RPC proxy; priority fees + robust confirm logic. |
| Mobile external-wallet UX is poor | Acceptable as interim only; Privy embedded wallet is the real mobile path. |

---

## 11. Open items to confirm before Phase 1

1. Deployment domain — `phoenix.trade` subdomain (true SSO) vs standalone?
2. Is `@ellipsis-labs/rise` published to npm, or do we vendor `rise-public/ts`?
3. Flight `feeBps` and the builder authority wallet.
4. Mainnet invite-gating: still required? how are codes distributed?
5. Branding/design — match `phoenix.trade`, or a distinct mobile identity?
