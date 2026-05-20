import type { Metadata } from "next";
import { CompetitionView } from "@/competition/CompetitionView";

/**
 * `/competition` — the live "Vibhu vs Drew" trading-challenge page.
 *
 * Standalone and public: no wallet or login required, since it reads only
 * public Phoenix trader endpoints. All data + layout live in <CompetitionView>.
 */
export const metadata: Metadata = {
  title: "Challenge — Vibhu vs Drew",
  description: "Live trading challenge between two wallets on Phoenix perps.",
};

export default function CompetitionPage() {
  return <CompetitionView />;
}
