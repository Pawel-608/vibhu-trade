import type { Metadata } from "next";
import { ReverseVibhuView } from "@/competition/ReverseVibhuView";

/**
 * `/competition/reverse-vibhu` — the "Reverse Vibhu Index" breakdown page.
 *
 * A hypothetical strategy that takes the exact opposite side of every one of
 * Vibhu's trades. Standalone and public: no wallet or login required, since it
 * reads only public Phoenix trader endpoints. All data + layout live in
 * <ReverseVibhuView>.
 */
export const metadata: Metadata = {
  title: "Reverse Vibhu Index — Challenge",
  description:
    "What if you traded the exact opposite of Vibhu, every trade? A live breakdown.",
};

export default function ReverseVibhuPage() {
  return <ReverseVibhuView />;
}
