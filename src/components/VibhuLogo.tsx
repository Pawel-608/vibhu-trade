/**
 * VibhuLogo — the Vibhu brand lockup (mark + wordmark + subtitle).
 *
 * The product is "Vibhu, built on Phoenix": only the consumer-facing brand
 * changes — the underlying Phoenix protocol/API keeps its name.
 *
 * The mark REUSES the original Phoenix icon — its two real tapered orange
 * blades (paths copied verbatim from `public/phoenix-logo.svg`). Instead of the
 * blades crossing into an X, the upper blade is moved down so the two blades
 * close together into an "O"-like shape.
 *
 * Layout mirrors the old logo: mark on the left, wordmark + subtitle stacked
 * to its right.
 */

const ORANGE = "#FFA548";

/** How far down the upper blade is shifted (SVG user units). */
const UPPER_BLADE_SHIFT = 8;

export interface VibhuLogoProps {
  /** Extra classes for the root element (e.g. sizing/spacing overrides). */
  className?: string;
  /** Height of the mark in px. Wordmark scales with it. Default 36. */
  size?: number;
}

/**
 * The mark — the original Phoenix icon's two real tapered orange blades, with
 * the upper blade shifted down by `UPPER_BLADE_SHIFT` so the blades close up
 * instead of crossing into an X. Both `d` strings are verbatim from
 * `public/phoenix-logo.svg`.
 */
function VibhuMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.5 4.5 31 31"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
    >
      {/* Lower blade — unchanged, exactly as in the original Phoenix mark. */}
      <path
        d="M28.4683 29.7869L27.3013 30.9724C24.7029 29.0334 22.1331 26.8755 19.1694 25.4949C15.2925 23.6888 12.301 24.0201 8.59521 25.99C6.02749 27.355 3.73144 29.229 1.41846 30.9724L0.219238 29.7996L14.3403 16.7117L28.4683 29.7869Z"
        fill={ORANGE}
      />
      {/* Upper blade — same path, shifted down so the two blades close up. */}
      <path
        d="M28.479 1.32009L14.3599 14.3836L0.233887 1.31033L1.3999 0.123804C3.71481 1.86677 5.97441 3.73354 8.5415 5.1072C12.631 7.29556 15.7857 7.36962 19.9175 5.21462C22.5571 3.83787 24.9232 1.9184 27.2827 0.123804L28.479 1.32009Z"
        fill={ORANGE}
        transform={`translate(0 ${UPPER_BLADE_SHIFT})`}
      />
    </svg>
  );
}

export function VibhuLogo({ className, size = 36 }: VibhuLogoProps) {
  return (
    <div
      className={`flex items-center gap-2.5 ${className ?? ""}`}
      aria-label="Vibhu"
      role="img"
    >
      <VibhuMark size={size} />
      <div className="flex flex-col leading-none">
        <span
          className="font-sans font-bold tracking-tight text-fg"
          style={{ fontSize: size * 0.72, lineHeight: 1 }}
        >
          vibhu
        </span>
        <span
          className="font-sans font-medium text-fg-subtle"
          style={{ fontSize: size * 0.26, marginTop: size * 0.1 }}
        >
          built on Phoenix
        </span>
      </div>
    </div>
  );
}

export default VibhuLogo;
