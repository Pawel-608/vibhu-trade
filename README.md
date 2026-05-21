# Vibhu

**Mobile-first, installable PWA for trading [Phoenix](https://phoenix.trade) perpetual futures.**

Vibhu is a lean, trade-first interface for Phoenix perps — markets, live
charts, orderbook, market & limit orders, positions, and collateral — tuned for
one-handed use on a 390 px phone viewport and installable to the home screen.

Built on Next.js (App Router) and the `@ellipsis-labs/rise` SDK, deployed to
Cloudflare Workers via OpenNext.

---

## Features

- **Trade** — market & limit orders with a bottom-sheet order entry; live mark
  price, positions, and open orders.
- **Markets & charts** — virtualized market list, TradingView
  `lightweight-charts` candlesticks, depth-aware orderbook, recent trades.
- **Account** — collateral deposit/withdraw (USDC), wallet funds, trader state,
  trade history.
- **Auth** — Privy social login with an embedded Solana wallet, plus an
  external wallet-adapter fallback (Phantom / Solflare).
- **PWA** — offline app shell, web manifest, service worker, installable.
- **Competition** — a public, no-login `/competition` page rendering a live
  head-to-head trading challenge straight from public Phoenix endpoints.

## Stack

Next.js (App Router) · React 19 · TypeScript · Tailwind CSS ·
`@ellipsis-labs/rise` (Phoenix perps SDK) · `@privy-io/react-auth` ·
`@solana/kit` v4 · TanStack Query · `lightweight-charts` · `react-window` ·
OpenNext + Cloudflare Workers.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Vibhu  (Next.js App Router PWA)                          │
│                                                           │
│  UI (React + Tailwind, mobile-first, bottom-sheet UX)     │
│       │                                                   │
│  Wallet abstraction  ──►  Privy embedded wallet           │
│       │                   (fallback: external adapter)    │
│  Rise client provider (createPhoenixClient)               │
│       │            │                │                    │
│   HTTP API      WS streams      ixs / orderPackets        │
└───────┼────────────┼────────────────┼────────────────────┘
        │            │                │
   perp-api.phoenix.trade        Solana RPC (via /api/rpc proxy)
   (REST + WSS)                  + Phoenix program / Flight
```

- **One-shot reads** (market list, history, trader snapshot) → HTTP, cached
  with TanStack Query.
- **Live data** (orderbook, mids, mark price, candles, trader state) → WebSocket
  streams, surfaced through the SDK's Zustand stores with leaf selectors.
- **Transactions** → built with `client.ixs`, assembled as `@solana/kit`
  transactions, signed by the wallet, submitted through the server-side RPC
  proxy.

The paid Solana RPC key never reaches the browser: the `/api/rpc` route
forwards JSON-RPC server-side. See [`PLAN.md`](./PLAN.md) for the full design
and [`CONTRACTS.md`](./CONTRACTS.md) for the directory-ownership map.

## Getting started

```bash
# 1. install dependencies
npm install

# 2. configure environment
cp .env.example .env.local
#    then fill in the variables below

# 3. run the dev server
npm run dev          # http://localhost:3000  →  redirects to /trade/SOL-PERP
```

The app targets a **390 px mobile viewport** — use a phone or device emulation
in your browser's dev tools.

### Environment variables

| Variable                            | Required | Purpose                                                              |
| ------------------------------------ | -------- | -------------------------------------------------------------------- |
| `SOLANA_RPC_URL`                     | yes      | Server-side Solana RPC endpoint the `/api/rpc` proxy forwards to. Never exposed to the browser. |
| `NEXT_PUBLIC_PHOENIX_API_URL`        | no       | Phoenix perps HTTP/WS API base URL. Defaults to `perp-api.phoenix.trade`. |
| `NEXT_PUBLIC_SOLANA_RPC_URL`         | no       | Browser-facing RPC URL — point it at the in-app `/api/rpc` proxy.    |
| `NEXT_PUBLIC_PRIVY_APP_ID`           | no       | Privy app ID. Blank disables social login (external-wallet path only). |
| `NEXT_PUBLIC_PHOENIX_REFERRAL_CODE`  | no       | Referral code applied to new accounts.                               |
| `NEXT_PUBLIC_FLIGHT_BUILDER_*`       | no       | Flight builder-fee routing — see [`scripts/FLIGHT-RUNBOOK.md`](./scripts/FLIGHT-RUNBOOK.md). |

See [`.env.example`](./.env.example) for the full, commented list.

## Scripts

| Command             | Description                                         |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Start the dev server.                               |
| `npm run build`     | Production build.                                   |
| `npm run start`     | Serve the production build.                         |
| `npm run lint`      | ESLint.                                             |
| `npm run typecheck` | `tsc --noEmit`.                                     |
| `npm run preview`   | Build with OpenNext and preview the Worker locally. |
| `npm run deploy`    | Build and deploy to Cloudflare Workers.             |

## Deployment

Vibhu deploys to **Cloudflare Workers** via
[OpenNext](https://opennext.js.org/cloudflare):

```bash
npm run deploy
```

Set `SOLANA_RPC_URL` as a **runtime** variable on the Worker (Variables and
Secrets) — not a build-time variable — so the RPC key stays server-side.

Custom analytics (wallet connects) run in a separate Worker under
[`analytics-worker/`](./analytics-worker/) using Workers Analytics Engine.

## Project layout

```
app/                 Next.js App Router routes + API proxies
  trade/[symbol]/    main trade screen (Markets / Trade / Account views)
  competition/       public live trading-challenge pages
  login/ onboarding/ auth + account-activation flows
  api/rpc/           server-side Solana RPC proxy
  api/phoenix/       Phoenix API proxy
src/
  providers/         shared providers (Query, Privy, Rise client)
  wallet/            wallet abstraction (AppWallet, useWallet)
  market-data/       Market Data feature area
  trading/           Trading feature area
  account/           Account feature area
  auth/              Auth feature area
  competition/       Challenge feature area
  components/        app-shell components (BottomNav, TradeScreen, …)
  lib/ types/        shared constants, formatting, types
public/              PWA manifest, icons, service worker
scripts/             one-off ops scripts (Flight builder registration, …)
analytics-worker/    standalone Cloudflare Worker for custom analytics
```

## Disclaimer

Vibhu is an independent, unofficial client for the Phoenix perps API and is not
affiliated with or endorsed by Phoenix. Trading perpetual futures carries
significant risk. Use at your own risk.
