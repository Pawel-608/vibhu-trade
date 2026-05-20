import type { ReactNode } from "react";

/**
 * Root template — unlike `layout.tsx`, this re-mounts on every route
 * navigation, so each page animates in. The `page-transition` class and its
 * keyframes live in `app/globals.css` (a fade + subtle slide-up, with a
 * `prefers-reduced-motion` opt-out).
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-transition">{children}</div>;
}
