# Phoenix Perps HTTP API — Reconnaissance

Reference for the Phoenix perpetual-futures HTTP/WS API, extracted from the Rise
SDK source (`rise-public/ts/src`) and verified against the live server.

- Source SDK: `@ellipsis-labs/rise` v0.4.9 (`rise-public/ts`)
- Base URL: **`https://perp-api.phoenix.trade`** (constant `DEFAULT_PHOENIX_API_URL` in `apiUrl.ts`)
- Probed live on 2026-05-20.

---

## 1. npm package status

- **Published: YES.** `@ellipsis-labs/rise` is on the public npm registry.
  - `npm view @ellipsis-labs/rise version` → `0.4.9`
  - Latest dist-tag `latest: 0.4.9`, published ~2 weeks ago by `jarryx`.
  - License MIT; 4 versions total; unpacked size 2.6 MB.
- **Matches local repo:** YES — `rise-public/ts/package.json` is also `0.4.9`
  (`"name": "@ellipsis-labs/rise"`, `"version": "0.4.9"`).
- **Conclusion:** The app can depend on `@ellipsis-labs/rise` directly from npm.
  No need to vendor `rise-public/ts`. Runtime deps: `@noble/hashes`, `@scure/base`,
  `@solana/kit ^4`, `fzstd`, `xstate ^5`, `zod ^4`, `zustand ^5`.

---

## 2. Base URL + endpoint table

Base URL: `https://perp-api.phoenix.trade` (trailing slash stripped by SDK).

Transport notes (`http/transport.ts`, `client.ts`):
- Every request runs through one `HttpTransport`. The SDK supports an `auth`
  mode per request: `"disabled" | "optional" | "required"` — default is
  `"optional"`. Auth is only attached if the client was constructed with
  `auth: true` and a session exists.
- None of the endpoints below declare `auth: "required"` in the SDK. The
  read-only public endpoints work with **no Authorization header**
  (verified live). Auth endpoints under `/v1/auth/*` and write/mutation flows
  use bearer tokens + Phoenix proof-of-possession headers (see Notes).
- The "auth-required" column reflects observed/practical behavior: read GETs are
  open; the write/order/auth/invite-mutation routes need a session.

### Exchange (`V1ExchangeClient` — api/exchange/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/exchange` | — | `ExchangeConfig` | No |
| GET | `/v1/exchange/snapshot` | — | `ExchangeSnapshotView` | No |
| GET | `/exchange/market/{symbol}` | — | `ExchangeMarketConfig` | No |
| GET | `/exchange/status` | — | `ExchangeStatusView` | No |
| GET | `/exchange/keys` | — | `ExchangeKeys` | No |
| GET | `/exchange/markets` | — | `ExchangeMarketConfig[]` | No |

### Markets (`V1MarketsClient` — api/markets/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/exchange/markets` | — | `ExchangeMarketConfig[]` | No |
| GET | `/exchange/market/{symbol}` | — | `ExchangeMarketConfig` | No |
| GET | `/v1/market/{symbol}/stats` | `start_time`, `end_time`, `limit`, `timeframe` (`MarketStatsHistoryParams`) | `MarketStatsHistoryResponse` | No |
| GET | `/v1/market/next-commodity-market-transition` | — | `NextCommodityMarketTransition` | No |

### Orderbook (`V1OrderbookClient` — api/orderbook/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/view/orderbook/{symbol}` | `includeSplines` (bool), `bypassExecutionBand` (bool) | `OrderbookView` | No |

### Candles (`V1CandlesClient` — api/candles/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/candles/{symbol}` | `timeframe` (req), `startTime`, `endTime`, `limit`, `enableExternalSource` (bool) (`TradingCandlesQuery`) | `ApiCandle[]` | No |

### Funding (`V1FundingClient` — api/funding/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/funding/{symbol}/rates` | `startTime`, `endTime`, `limit` | `FundingRateHistoryResponse` | No |
| GET | `/v1/funding/overview` | `startTime`, `endTime`, `perMarketLimit` | `FundingOverviewResponse` | No |
| GET | `/v1/users/{userPubkey}/funding-hourly` | `symbol`, `limit`, `cursor`, `traderPdaIndex` | `FundingHourlyHistoryResponse` | No (public-readable) |
| GET | `/trader/{authority}/funding-history` | `traderPdaIndex`, `symbol`, `startTime`, `endTime`, `limit`, `cursor`, `resolution` | `TraderFundingHistoryResponse` | No (public-readable) |

### Trades (`V1TradesClient` — api/trades/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/market/{symbol}/fills` | `limit`, `cursor` | `MarketFillsResponse` | No |
| GET | `/trader/{authority}/trades-history` | `pdaIndex`, `marketSymbol`, `limit`, `cursor`, `privyId` | `FillsResponse` | No (public-readable) |
| GET | `/v1/traders/{traderPubkey}/trades_v2` | `market_symbol`, `limit`, `cursor`, `privy_id` (snake_case!) | `TradeHistoryV2Response` | No (public-readable) |

### Orders (`V1OrdersClient` — api/orders/client.ts)

| Method | Path | Query params / body | Response type | Auth |
|---|---|---|---|---|
| GET | `/trader/{authority}/order-history` | `traderPdaIndex`, `marketSymbol`, `limit`, `cursor`, `privyId`, `orderStatus` | `OrderHistoryResponse` | No (public-readable) |
| GET | `/v1/traders/{traderPubkey}/orders_v2` | `market_symbol`, `limit`, `cursor`, `start_time` (ISO), `end_time` (ISO) (snake_case!) | `OrderHistoryV2Response` | No (public-readable) |
| POST | `/v1/ix/cancel-conditional-order` | body: `CancelConditionalOrderRequest` | `ApiInstructionResponse[]` | Yes (returns Solana ixs to sign) |
| POST | `/v1/ix/place-isolated-limit-order` | body: `PlaceIsolatedLimitOrderRequest` | `ApiInstructionResponse[]` | Yes |
| POST | `/v1/ix/place-isolated-limit-order-enhanced` | body: `PlaceIsolatedLimitOrderRequest` | `PlaceIsolatedOrderEnhancedResponse` | Yes |
| POST | `/v1/ix/place-isolated-market-order` | body: `PlaceIsolatedMarketOrderRequest` | `ApiInstructionResponse[]` | Yes |
| POST | `/v1/ix/place-isolated-market-order-enhanced` | body: `PlaceIsolatedMarketOrderRequest` | `PlaceIsolatedOrderEnhancedResponse` | Yes |

Note: the `/v1/ix/*` endpoints are instruction *builders* — they return Solana
instructions for the client to sign and submit. They do not place orders
server-side.

### Traders (`V1TradersClient` — api/traders/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/view/trader/{pubkey}` | — | `TraderView` | No (public-readable) |
| GET | `/trader/{authority}/state` | `pdaIndex` | `TraderStateResponse` | No (public-readable) |
| GET | `/v1/trader/state/{authority}` | `traderPdaIndex` | `TraderStateSnapshotResponse` | No (public-readable) |
| GET | `/trader/{authority}/pnl` | `resolution` (req), `startTime`, `endTime`, `limit`, `includeEarliest`, `includeLatest` | `PnlDataPoint[]` | No (public-readable) |
| GET | `/v1/traders/{traderPubkey}/portfolio-values` | same `HistoricalValuesRequest` set | `PortfolioValueDataPoint[]` | No (public-readable) |
| GET | `/v1/traders/{traderPubkey}/pnl` | same `HistoricalValuesRequest` set | `PnlDataPoint[]` | No (public-readable) |
| GET | `/v1/view/trader-capabilities` | — | `TraderCapabilitiesMetadata` | No |
| GET | `/v1/traders/{traderPubkey}/pnl/markets` | `resolution` (req), `startTime`, `endTime`, `limit`, `symbols` (array) | `TraderMarketPnLSeries[]` | No (public-readable) |

### Collateral (`V1CollateralClient` — api/collateral/client.ts)

| Method | Path | Query params | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/users/{userPubkey}/collateral-history` | `limit`, `nextCursor`, `prevCursor`, `cursor` | `CollateralHistoryResponse` | No (public-readable) |
| GET | `/trader/{authority}/collateral-history` | `pdaIndex`, `limit`, `nextCursor`, `prevCursor`, `cursor` | `CollateralHistoryResponse` | No (public-readable) |

### Notifications (`V1NotificationsClient` — api/notifications/client.ts)

| Method | Path | Query params / body | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/traders/{traderPubkey}/notifications` | `GetNotificationsQuery` (limit/cursor/etc.) | `GetNotificationsResponse` | Likely (per-trader) |
| POST | `/v1/traders/{traderPubkey}/notifications/ack/up-to` | body: `AckBeforeTimestampBody` | `{ ok: boolean }` | Yes (mutation) |
| POST | `/v1/traders/{traderPubkey}/notifications/ack/notifications` | body: `AckNotificationsBody` | `{ ok: boolean }` | Yes (mutation) |

### Invite (`V1InviteClient` — api/invite/client.ts)

| Method | Path | Query params / body | Response type | Auth |
|---|---|---|---|---|
| GET | `/v1/invite/check/{wallet}` | — | `CheckWalletResponse` | No |
| POST | `/v1/invite/validate` | body: `ValidateInviteRequest` | `ValidateInviteResponse` | No |
| POST | `/v1/invite/activate` | body: `ActivateInviteRequest` | `ActivateInviteResponse` | Yes (wallet-signed) |
| POST | `/v1/invite/activate-with-referral` | body: `ActivateInviteWithReferralRequest` | `ActivateInviteResponse` | Yes (wallet-signed) |

### Auth (`PhoenixAuthClient` — auth/client.ts) — for completeness, NOT probed

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/login/privy` | Privy token login → `AuthResponse` |
| POST | `/v1/auth/nonce` | Wallet login nonce → `WalletNonceResponse` |
| POST | `/v1/auth/login/wallet` | Wallet-signature login → `AuthResponse` |
| POST | `/v1/auth/login/service/challenge` | Service login challenge |
| POST | `/v1/auth/login/service` | Service login → `AuthResponse` |
| POST | `/v1/auth/refresh` | Refresh token → `AuthResponse` |
| POST | `/v1/auth/logout` | Invalidate session |
| GET  | `/v1/auth/jwks` | JSON Web Key Set |

`AuthResponse`: `{ token_type:"Bearer", access_token, expires_in, refresh_token,
refresh_expires_in, pop_key }`.

---

## 3. Live response samples

All probed unauthenticated on `https://perp-api.phoenix.trade`, 2026-05-20.

### `GET /exchange/status` → 200
```json
{ "active": true, "gated": true }
```

### `GET /exchange` → 200 (trimmed; `markets` array has 29 entries)
```json
{
  "keys": {
    "globalConfig": "2zskx2iyCvb6Stg7RBZkt1f6MrF4dpYtMG3yMvKwqtUZ",
    "currentAuthorities": { "rootAuthority": "GPgADQrhzGoUgLqxsZMKvSpwcLaJFVTq6gEixKhmcwpm", "...": "..." },
    "pendingAuthorities": { "rootAuthority": "11111111111111111111111111111111", "...": "..." },
    "canonicalMint": "PhUsd11YkbjSaWjFncfAAmatntsjx3MgDR9B6g1ks3A",
    "globalVault": "csZXgw2G58hbiWc9ndxaxrQVYVvqdXgQzYLuznEzHJu",
    "perpAssetMap": "2nHGAaEw3D5dd4hVueaUNoygkQFmoeKqRQWnSPqSMFUC"
  },
  "markets": [
    {
      "symbol": "TAO", "assetId": 11, "marketStatus": "active",
      "marketPubkey": "CoshgxCZygQnS5jJLi24DkuJN4hddRNdPVSmTWrURbHu",
      "splinePubkey": "6E5o1ZzEwxW7xWwR6YPbYEL53bDpYTtqoQfXLLxXss7j",
      "tickSize": 100, "baseLotsDecimals": 3,
      "takerFee": 0.00035, "makerFee": 0.00005,
      "leverageTiers": [
        { "maxLeverage": 5.0, "maxSizeBaseLots": 1470000, "limitOrderRiskFactor": 100.0 }
      ],
      "riskFactors": { "maintenance": 50.0, "backstop": 20.0, "highRisk": 10.0,
                       "upnl": 100.0, "upnlForWithdrawals": 1.0, "cancelOrder": 75.0 },
      "fundingIntervalSeconds": 3600, "fundingPeriodSeconds": 86400,
      "maxFundingRatePerInterval": 775,
      "maxFundingRatePerIntervalPercentage": 0.2958015267175573,
      "openInterestCapBaseLots": "1470000",
      "maxLiquidationSizeBaseLots": "150000",
      "isolatedOnly": false
    }
  ]
}
```

### `GET /v1/exchange/snapshot` → 200 (trimmed)
```json
{
  "version": 1, "slot": 420900694, "slotIndex": 688,
  "exchange": {
    "programId": "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih",
    "globalConfig": "2zskx2iyCvb6Stg7RBZkt1f6MrF4dpYtMG3yMvKwqtUZ",
    "currentAuthorities": { "rootAuthority": "GPgADQrhzGoUgLqxsZMKvSpwcLaJFVTq6gEixKhmcwpm", "...": "..." },
    "canonicalMint": "PhUsd11YkbjSaWjFncfAAmatntsjx3MgDR9B6g1ks3A",
    "usdcMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "globalVault": "csZXgw2G58hbiWc9ndxaxrQVYVvqdXgQzYLuznEzHJu",
    "exchangeStatusBits": 131,
    "exchangeStatusFeatures": ["initialized", "active", "gated"],
    "active": true, "gated": true
  }
}
```

### `GET /exchange/markets` → 200 (array, 29 items; first item trimmed)
```json
{
  "symbol": "VVV", "assetId": 24, "marketStatus": "active",
  "marketPubkey": "5kPZcErZ12YbqhUHzguCgYyjMVHxpiMAW324KL2jWVHQ",
  "splinePubkey": "7CyFxgjHDxGt4hU3JoFuiFygAedgmHVY5CYoB2Tdezyx",
  "tickSize": 10, "baseLotsDecimals": 2,
  "takerFee": 0.00035, "makerFee": 5e-05,
  "leverageTiers": [
    { "maxLeverage": 5.0, "maxSizeBaseLots": 2957000, "limitOrderRiskFactor": 100.0 }
  ],
  "riskFactors": { "maintenance": 50.0, "backstop": 20.0, "highRisk": 10.0,
                   "upnl": 100.0, "upnlForWithdrawals": 1.0, "cancelOrder": 75.0 },
  "fundingIntervalSeconds": 3600, "fundingPeriodSeconds": 86400,
  "maxFundingRatePerInterval": 391,
  "maxFundingRatePerIntervalPercentage": 0.2260769008383926,
  "openInterestCapBaseLots": "2957000",
  "maxLiquidationSizeBaseLots": "296000",
  "isolatedOnly": false
}
```

### `GET /exchange/market/SOL` → 200 (trimmed)
```json
{
  "symbol": "SOL", "assetId": 0, "marketStatus": "active",
  "marketPubkey": "71Si24E4uc3oCaPbPZTozC1ptSNNqygjjebxSmErSsC2",
  "splinePubkey": "EVhkquLbfm5rDRXtZu9FoyDSXX5mYq2EYU6yD8zfKEqM",
  "tickSize": 100, "baseLotsDecimals": 2,
  "takerFee": 0.00035, "makerFee": 0.00005,
  "leverageTiers": [
    { "maxLeverage": 15.0, "maxSizeBaseLots": 12000000, "limitOrderRiskFactor": 100.0 }
  ]
}
```

### `GET /v1/view/orderbook/SOL` → 200 (trimmed; bids/asks are `[price, size]` tuples)
```json
{
  "slot": 420961143,
  "symbol": "SOL",
  "bids": [ [85.01, 87.59], [85.0, 416.16], [84.99, 2031.07] ],
  "asks": [ "..." ]
}
```
Note: response also includes optional `mid` and `splines` per the schema; not
present in this default (no-param) response.

### `GET /v1/candles/SOL?timeframe=1h&limit=3` → 200 (array)
```json
[
  {
    "time": 1779256800000, "open": 84.84, "high": 85.06,
    "low": 84.78999999999999, "close": 85.05,
    "markOpen": 84.82, "markHigh": 85.05, "markLow": 84.76, "markClose": 85.02,
    "volume": 938.16, "volumeQuote": 79757.0256, "tradeCount": 306
  }
]
```
`time` is epoch **milliseconds**.

### `GET /v1/funding/SOL/rates?limit=3` → 200
```json
{
  "marketId": 1,
  "symbol": "SOL",
  "rates": [
    { "timestamp": 1778666400, "fundingRatePercentage": "0.000418" },
    { "timestamp": 1778670000, "fundingRatePercentage": "0.000316" },
    { "timestamp": 1778673600, "fundingRatePercentage": "0.000530" }
  ]
}
```
`timestamp` here is epoch **seconds**; `fundingRatePercentage` is a string.

### `GET /v1/funding/overview?perMarketLimit=2` → 200 (trimmed)
```json
{
  "series": [
    {
      "marketId": 1858, "symbol": "AAVE",
      "points": [
        { "timestamp": 1779264000, "fundingAmountPerUnit": "0.000000000000",
          "markPrice": "87.730000000000", "fundingRate": "0.000000000000" }
      ]
    }
  ]
}
```

### `GET /v1/market/SOL/stats?limit=2` → 200
```json
{
  "market_id": 1, "symbol": "SOL", "timeframe": null,
  "stats": [
    { "open_interest": 16576.28, "total_maker_fees": 556.501084,
      "total_taker_fees": 17106.973832, "mark_price": 85.12,
      "spot_price": 85.08, "timestamp": "2026-05-20T08:45:18Z", "slot": 420952161 }
  ]
}
```
Note: `MarketStatsHistoryResponse` uses **snake_case** keys.

### `GET /v1/market/next-commodity-market-transition` → 200
```json
{
  "market": "cme_commodities",
  "loadedAt": "2026-05-20T09:44:55.721237863Z",
  "utcNextTransition": "2026-05-20T21:00:00Z",
  "nextMarketState": "afterHours",
  "currentState": "open"
}
```

### `GET /market/SOL/fills?limit=2` → 200 (trimmed)
```json
{
  "data": [
    {
      "marketSymbol": "SOL", "baseQty": "0.18", "quoteQty": "-15.2982",
      "price": "84.99", "timestamp": "2026-05-20T09:45:22Z",
      "transactionSignature": "5cvah5938RmZ6y43He8srfr72AEm5N4SBBfgok1N4hxBsxz9gp457ozh6KRWE5wwKZchKiLJHUWYaoC1bVmVcGPr",
      "instructionType": "PlaceMarketOrder"
    }
  ],
  "nextCursor": "b2xkZXIsMTc3OTI3MDMyMTAwMCw0MjA5NjEyMDUsNTg1LDQ=",
  "hasMore": true
}
```
Note: SDK schema declares `timestamp` numeric but the live API returns an ISO
string here — the SDK's `toNumber` coerces ISO strings via `Date.parse`, so it
parses fine.

### `GET /v1/view/trader-capabilities` → 200 (trimmed)
```json
{
  "capabilities": [
    { "key": "placeLimitOrder", "displayName": "Place Limit Orders",
      "description": "Allows resting liquidity on the book." },
    { "key": "placeMarketOrder", "displayName": "Place Market Orders", "...": "..." }
  ]
}
```

### `GET /trader/{authority}/state` → 200 even for an unknown authority
Probed with the system-program pubkey `11111111111111111111111111111111`:
```json
{
  "slot": 420961249, "slotIndex": 740,
  "authority": "11111111111111111111111111111111",
  "pdaIndex": 0,
  "traders": [ { "flags": 62, "state": "cold", "capabilities": { "...": "..." } } ]
}
```

### `GET /v1/invite/check/{wallet}` → 200
```json
{ "whitelisted": false, "whitelisted_at": null, "invite_code_used": null }
```

---

## 4. WebSocket

- WS URL is derived from the API URL by `toWebSocketUrl(apiUrl, "/v1/ws")`
  (`ws/url.ts`): `https://` → `wss://`.
- **WS base URL: `wss://perp-api.phoenix.trade/v1/ws`**
- Subscribe / unsubscribe message shape (`ws/types.ts`):
  ```json
  { "type": "subscribe", "subscription": { "channel": "...", "...": "..." } }
  ```
- Server error frames: `{ "channel": "error", "error": string, "code": number }`.
- Channel names (from `ws/adapters/*/wire.ts` and `*/plugin.ts`):

  | Channel literal | Adapter | Purpose |
  |---|---|---|
  | `allMids` | all-mids | All markets mid prices |
  | `candle` | candles | OHLC candle updates |
  | `exchange` | exchange | Exchange config/snapshot updates |
  | `exchangeStatus` | exchange-status | Exchange status (active/gated) |
  | `fills` | fills | Trade fills |
  | `fundingRate` | funding-rate | Funding rate updates |
  | `l2Book` | l2-book | L2 orderbook (aggregated) |
  | `markPrice` | mark-price | Mark price updates |
  | `market` | market | Per-market view updates |
  | `marketStats` | market-stats | Market stats (OI, fees, prices) |
  | `notification` | notifications | Per-trader notifications |
  | `orderbook` | orderbook | Orderbook snapshot stream |
  | `traderState` | trader-state | Per-trader state updates |
  | `subscriptionStatus` | (internal) | Sub/unsub ack channel |

  Note: the subscribe `channel` value can differ from the inbound message
  `channel` (e.g. candles subscribe on `candles`, messages arrive on `candle`;
  notifications subscribe on `notifications`, messages on `notification`). The
  `PhoenixWsClient` facade exposes adapters: `allMids`, `candles`, `exchange`,
  `exchangeStatus`, `fills`, `fundingRate`, `l2Book`, `markPrice`, `market`,
  `marketStats`, `notifications`, `orderbook`, `orderbookSnapshot`.
- WS supports an optional auth lifecycle (`ws/authLifecycleMachine.ts`,
  `authMode` config) for trader/notification subscriptions; public channels do
  not require auth.

---

## 5. Notes / surprises

- **Symbols are bare tickers, not `-PERP` suffixed.** Use `SOL`, `BTC`, `ETH`,
  etc. `GET /v1/view/orderbook/SOL-PERP` returns
  `404 {"error":"Orderbook not found for symbol: SOL-PERP"}`. There are 29
  active markets (`/exchange/markets`).
- **Exchange is `gated`.** `/exchange/status` reports `"gated": true` and the
  snapshot lists feature `gated`. Trading/order placement is invite-gated —
  see the `/v1/invite/*` routes. Read-only public market data is **not** gated
  and works with no auth (all section-3 probes returned 200 anonymously).
- **CORS is wide open** — good for a browser app:
  - `access-control-allow-origin: *`
  - `access-control-allow-methods: *`
  - `access-control-allow-headers: authorization, content-type, accept,
    x-phoenix-client, x-phoenix-nonce, x-phoenix-mac, x-phoenix-actor-context,
    traceparent, tracestate, baggage`
  - `access-control-expose-headers: x-phoenix-ctr-hash, retry-after`
  - `vary: origin, access-control-request-method, access-control-request-headers`
  - OPTIONS preflight on `/exchange` returns `200`.
- **Rate limiting:** The transport reads a `Retry-After` header on errors and
  the SDK retries `429` once after re-auth (`client.ts`). `retry-after` is in
  `access-control-expose-headers`, so a `429` + `Retry-After` flow exists. No
  explicit `RateLimit-*` headers were observed on successful responses.
- **Required/optional headers:**
  - `X-Phoenix-Client` (`clientIdentity.ts`, `PHOENIX_CLIENT_HEADER_NAME`) —
    client-identity header attached by the SDK; not required for public GETs
    in practice but the SDK always sends it.
  - Authenticated requests: `Authorization: Bearer <access_token>` plus
    Phoenix proof-of-possession headers (`x-phoenix-nonce`, `x-phoenix-mac`,
    `x-phoenix-actor-context`) per the CORS allow-list.
- **Error response shape:** errors are JSON `{ "error": "<code/message>" }`.
  The SDK's `PhoenixHttpError` parses `error` (code) and `message` fields and
  surfaces `status`, `retryAfter`, and the raw body.
- **Casing inconsistency — watch out:** query param and response casing is
  *not* uniform.
  - Camel-case query params: candles, funding, orderbook, market stats
    (`startTime`, `endTime`, `perMarketLimit`, etc.).
  - Snake-case query params: `orders_v2` and `trades_v2`
    (`market_symbol`, `start_time`, `end_time`, `privy_id`).
  - Snake-case response bodies: `MarketStatsHistoryResponse`,
    `PriceHistoryResponse` (`market_id`, `open_interest`, `mark_price`...).
  - The `v2` trade/order endpoints live under `/v1/traders/...` while the
    legacy ones live under `/trader/...` (singular, no `/v1`).
- **Timestamp units differ per endpoint:** candles `time` is epoch **ms**;
  funding-rate `timestamp` is epoch **seconds**; market-stats/fills use ISO-8601
  strings. The SDK normalizes most numeric fields via a `toNumber` helper that
  also accepts ISO strings.
- **`/v1/ix/*` order routes are instruction builders**, not order placement —
  they return Solana `ApiInstructionResponse[]` for the client to sign and
  submit on-chain. The mobile app will need a Solana wallet/signer and an RPC
  to actually place orders; the HTTP API only builds the transactions.
- **Trader-scoped GETs are publicly readable.** `/trader/{authority}/state`,
  `/v1/view/trader/{pubkey}`, order/trade history, etc. returned data with no
  auth (probed with a dummy authority). Notifications and any mutation
  (`ack`, `activate`, `/v1/ix/*`) require a session.
- **Number precision:** market configs use JSON numbers like `5e-05` for
  `makerFee` — parse as float, do not assume fixed-decimal strings. Monetary
  quantities in fills/funding are returned as **strings**.
