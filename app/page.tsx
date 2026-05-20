import { redirect } from "next/navigation";
import { tradeRoute } from "@/lib/constants";

/**
 * Root route — redirect to the default market's trade screen (PLAN.md §7).
 */
export default function HomePage() {
  redirect(tradeRoute());
}
