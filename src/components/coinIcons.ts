/**
 * Static ticker -> CoinGecko icon-URL map.
 *
 * The Phoenix perps API exposes no token logo for markets, and CoinGecko icon
 * URLs (`coin-images.coingecko.com/...`) cannot be derived from a ticker — they
 * must be resolved. They were resolved once, at build time, against the
 * CoinGecko `coins/markets` endpoint (best market-cap rank per symbol) and
 * baked into this map. There are NO runtime CoinGecko calls — this avoids rate
 * limits and CORS entirely.
 *
 * Keyed by UPPERCASE Phoenix market ticker. Markets with no good CoinGecko
 * icon — the `WTIOIL` crude-oil index, and `GOLD`/`SILVER` (which only resolve
 * to unrelated low-cap tokens) — are intentionally omitted; `CoinIcon` renders
 * a monogram for those.
 *
 * To refresh: re-run the CoinGecko `coins/markets?symbols=...` resolution for
 * the current `/exchange/markets` symbol list.
 */
export const COIN_ICON_URLS: Record<string, string> = {
  AAVE: "https://coin-images.coingecko.com/coins/images/12645/large/aave-token-round.png?1720472354",
  BNB: "https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png?1696501970",
  BTC: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400",
  CHIP: "https://coin-images.coingecko.com/coins/images/102171777/large/CHIP_Token_Logo_Large.png?1776777444",
  DOGE: "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png?1696501409",
  ENA: "https://coin-images.coingecko.com/coins/images/36530/large/ethena.png?1711701436",
  ETH: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628",
  FARTCOIN: "https://coin-images.coingecko.com/coins/images/50891/large/fart.jpg?1729503972",
  HYPE: "https://coin-images.coingecko.com/coins/images/50882/large/hyperliquid.jpg?1729431300",
  JTO: "https://coin-images.coingecko.com/coins/images/33228/large/jto.png?1701137022",
  JUP: "https://coin-images.coingecko.com/coins/images/34188/large/jup.png?1704266489",
  LIT: "https://coin-images.coingecko.com/coins/images/71121/large/lighter.png?1765888098",
  MEGA: "https://coin-images.coingecko.com/coins/images/69995/large/9fcb2fa4-b240-46e2-9016-c4f6101a139d.jpeg?1778485816",
  MET: "https://coin-images.coingecko.com/coins/images/69110/large/meteora.png?1757517561",
  MON: "https://coin-images.coingecko.com/coins/images/38927/large/mon.png?1766029057",
  NEAR: "https://coin-images.coingecko.com/coins/images/10365/large/near.jpg?1696510367",
  PUMP: "https://coin-images.coingecko.com/coins/images/67164/large/pump.jpg?1751949376",
  SKR: "https://coin-images.coingecko.com/coins/images/70974/large/seeker-logo.jpg?1764922774",
  SOL: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png?1718769756",
  SUI: "https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png?1727791290",
  TAO: "https://coin-images.coingecko.com/coins/images/28452/large/ARUsPeNQ_400x400.jpeg?1696527447",
  TON: "https://coin-images.coingecko.com/coins/images/17980/large/photo_2024-09-10_17.09.00.jpeg?1725963446",
  VVV: "https://coin-images.coingecko.com/coins/images/54023/large/VVV_Token_Transparent.png?1741856877",
  XPL: "https://coin-images.coingecko.com/coins/images/66489/large/Plasma-symbol-green-1.png?1755142558",
  XRP: "https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png?1696501442",
  ZEC: "https://coin-images.coingecko.com/coins/images/486/large/circle-zcash-color.png?1696501740",
};
