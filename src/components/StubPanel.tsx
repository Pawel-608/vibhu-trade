/**
 * StubPanel — a clearly-labelled "TODO" placeholder.
 *
 * Used by every feature stub so the skeleton compiles and renders while the
 * four feature agents fill in real UI. Feature agents may keep importing this
 * for sub-areas that are not done yet, or delete usages as they implement.
 *
 * SHARED primitive. Lives in `src/components/` — treat as read-only shared
 * code (do not edit; safe to import from any feature dir).
 */

import { cn } from "@/lib/cn";

export interface StubPanelProps {
  /** Name of the component/feature this placeholder stands in for. */
  label: string;
  /** One-line description of what will render here. */
  hint?: string;
  /** Extra classes for layout (e.g. height) at the call site. */
  className?: string;
}

export function StubPanel({ label, hint, className }: StubPanelProps) {
  return (
    <div
      className={cn(
        "flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-bg-elevated p-6 text-center",
        className,
      )}
    >
      <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
        TODO
      </span>
      <span className="text-sm font-medium text-fg">{label}</span>
      {hint ? (
        <span className="max-w-xs text-xs leading-snug text-fg-subtle">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
