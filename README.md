# Phoenix Mobile

A mobile-first, installable PWA for trading **Phoenix perpetual futures**.

Built on Next.js (App Router) + the `@ellipsis-labs/rise` SDK. See `PLAN.md`
for the full project plan and `CONTRACTS.md` for the directory-ownership map
and shared-contract rules.

## Stack

Next.js · React · TypeScript · Tailwind CSS · `@ellipsis-labs/rise` (Phoenix
perps SDK) · `@privy-io/react-auth` · `@solana/kit` · TanStack Query ·
`lightweight-charts` · `react-window`.

## Getting started

```bash
# 1. install dependencies
npm install

# 2. configure environment
cp .env.example .env.local
# then fill in NEXT_PUBLIC_SOLANA_RPC_URL and (optionally) NEXT_PUBLIC_PRIVY_APP_ID

# 3. run the dev server
npm run dev          # http://localhost:3000  -> redirects to /trade/SOL-PERP
```

The app is designed for a 390px mobile viewport — use a phone or device
emulation in your browser.

## Scripts

| Command             | Description                            |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Start the dev server.                  |
| `npm run build`     | Production build.                      |
| `npm run start`     | Serve the production build.            |
| `npm run lint`      | ESLint.                                |
| `npm run typecheck` | `tsc --noEmit`.                        |

## Environment variables

| Variable                     | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_PHOENIX_API_URL` | Phoenix perps HTTP/WS API base URL.                |
| `NEXT_PUBLIC_SOLANA_RPC_URL`  | Solana RPC endpoint (use the `/api/rpc` proxy in prod). |
| `NEXT_PUBLIC_PRIVY_APP_ID`    | Privy app ID. Blank = external-wallet path only.   |

## Project layout

```
app/                 Next.js App Router routes + PWA manifest link
  trade/[symbol]/    the main trade screen (Markets/Trade/Account views)
  login/  onboarding/
src/
  providers/         shared providers (Query, Privy, Rise client)
  wallet/            wallet abstraction (AppWallet, useWallet)
  lib/  types/        shared constants, formatting, types
  components/        app-shell components (BottomNav, TradeScreen, ...)
  market-data/       Market Data feature area
  trading/           Trading feature area
  auth/              Auth feature area
  account/           Account feature area
public/              PWA manifest, icons, service worker
```
