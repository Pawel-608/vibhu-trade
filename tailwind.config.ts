import type { Config } from "tailwindcss";

/**
 * Dark trading-app theme tuned for one-handed mobile use (390px viewport).
 * Orange-forward Phoenix branding: warm near-black surfaces and orange-warm
 * borders/text all lean into the Phoenix orange accent (#ffa548, the logo
 * mark) so the whole shell reads as Phoenix — not just the accent. The app
 * runs hotter/more orange than phoenix.trade's cooler zinc theme by design.
 * green = price up, red = price down — matched to phoenix.trade.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces — warm near-blacks carrying a distinct orange tint so the
        // whole shell reads as Phoenix-branded, not just the accent.
        bg: {
          DEFAULT: "#0c0a09", // warm near-black app background
          elevated: "#1b1512", // cards / sheets / order book
          muted: "#251d17", // inputs, inactive pills
        },
        border: {
          DEFAULT: "#3a2c1f", // orange-warm hairline
          strong: "#4f3b27", // orange-warm, emphasized
        },
        // Text — warm whites/tans tuned to sit on the warm surfaces.
        fg: {
          DEFAULT: "#f5efe8", // primary text
          muted: "#b59a82", // secondary text
          subtle: "#7a6452", // tertiary / disabled
        },
        // Trading semantics — green/red matched to phoenix.trade.
        up: {
          DEFAULT: "#4ade80", // green — long / price up
          bg: "rgba(74,222,128,0.12)",
        },
        down: {
          DEFAULT: "#f65a5a", // red — short / price down
          bg: "rgba(246,90,90,0.12)",
        },
        accent: {
          DEFAULT: "#ffa548", // Phoenix brand orange (the logo mark)
          hot: "#ff8a3d", // hotter ember orange — gradients, glows
          bg: "rgba(255,165,72,0.14)", // low-opacity orange tint
          fg: "#20140a", // very dark text/icons on an orange surface
        },
      },
      fontFamily: {
        // `var(...)` carries an in-value fallback so the declaration stays
        // valid even if the font fails to load (otherwise it falls back to
        // the browser default — a serif).
        sans: [
          "var(--font-sans, system-ui)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono, ui-monospace)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      maxWidth: {
        app: "430px", // mobile app shell cap
      },
      spacing: {
        nav: "56px", // bottom nav height
        header: "52px", // market header height
      },
      boxShadow: {
        // Orange brand glow — for active CTAs, focused order buttons, etc.
        glow: "0 0 24px -6px rgba(255,165,72,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
