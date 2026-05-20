import { TradeScreen } from "@/components/TradeScreen";

/**
 * `/trade/[symbol]` — the main trade screen (PLAN.md §7).
 *
 * The route param selects the market. The Markets / Trade / Account views are
 * client-side toggles inside <TradeScreen>, not nested routes.
 */
export default async function TradePage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <TradeScreen symbol={decodeURIComponent(symbol)} />;
}
