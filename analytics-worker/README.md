# Vibhu analytics worker

A standalone Cloudflare Worker that records custom events (wallet connects)
into **Workers Analytics Engine**. It is intentionally separate from the main
Vibhu app so it cannot affect that deploy.

- `POST /track` — body `{ event, wallet, walletKind }` → writes one data point.
- Dataset: `vibhu_events` (binding `AE`).

## 1. Deploy

**Option A — CLI**

```bash
cd analytics-worker
npx wrangler login      # once
npx wrangler deploy
```

Deploy prints the URL, e.g. `https://vibhu-analytics.<subdomain>.workers.dev`.

**Option B — Dashboard (no CLI)**

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Name it `vibhu-analytics`, paste the contents of `src/index.js`, **Deploy**.
3. Worker → **Settings → Bindings → Add → Analytics Engine**:
   - Variable name: `AE`
   - Dataset: `vibhu_events`
4. **Deploy** again so the binding takes effect.

## 2. Point the app at it

Set a **build variable** on the main Vibhu app in Cloudflare:

```
NEXT_PUBLIC_ANALYTICS_URL = https://vibhu-analytics.<subdomain>.workers.dev
```

Then redeploy the app. Until this is set, `trackWalletConnect()` is a no-op —
analytics is fully optional and never blocks a wallet connect.

## 3. Query the data

Use the Analytics Engine **SQL API**. You need your Cloudflare account ID and an
API token with **Account Analytics → Read**.

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data "SELECT count(DISTINCT index1) AS distinct_wallets
          FROM vibhu_events WHERE blob1 = 'wallet_connect'"
```

Useful queries (pass as the `--data` body):

```sql
-- Distinct wallets ever connected
SELECT count(DISTINCT index1) AS distinct_wallets
FROM vibhu_events WHERE blob1 = 'wallet_connect';

-- Connects in the last 24h (sampling-corrected)
SELECT sum(_sample_interval) AS connects
FROM vibhu_events
WHERE blob1 = 'wallet_connect' AND timestamp > NOW() - INTERVAL '1' DAY;

-- Distinct wallets by wallet kind
SELECT blob2 AS kind, count(DISTINCT index1) AS wallets
FROM vibhu_events WHERE blob1 = 'wallet_connect' GROUP BY kind;

-- Distinct wallets by country
SELECT blob3 AS country, count(DISTINCT index1) AS wallets
FROM vibhu_events WHERE blob1 = 'wallet_connect'
GROUP BY country ORDER BY wallets DESC;
```

Schema: `index1` = wallet address · `blob1` = event · `blob2` = wallet kind ·
`blob3` = country · `double1` = 1 · `timestamp` = event time.
