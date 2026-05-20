import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/providers/AppProviders";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

/**
 * UI typeface — Inter (clean grotesk, Hyperliquid-style) — and a tabular mono
 * for prices/sizes. Exposed as the `--font-sans` / `--font-mono` CSS variables
 * consumed by `tailwind.config.ts`.
 */
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Phoenix Mobile",
  description: "Mobile-first trading for Phoenix perpetual futures.",
  manifest: "/manifest.webmanifest",
  applicationName: "Phoenix Mobile",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Phoenix Mobile",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0a09",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div id="app-shell" className="mx-auto min-h-dvh max-w-app bg-bg">
          <AppProviders>{children}</AppProviders>
        </div>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
