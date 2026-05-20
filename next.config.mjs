/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Rise SDK (`@ellipsis-labs/rise`) ships pure ESM; transpile it so
  // Next can bundle it for both server and client. See PLAN.md §3.
  transpilePackages: ["@ellipsis-labs/rise"],
  webpack: (config) => {
    // `@privy-io/react-auth` references some optional peer integrations we do
    // not use (e.g. Farcaster mini-app Solana). Mark them external so webpack
    // does not emit "module not found" warnings for code paths never run.
    config.externals = config.externals ?? [];
    config.externals.push({
      "@farcaster/mini-app-solana": "commonjs @farcaster/mini-app-solana",
    });
    return config;
  },
};

export default nextConfig;
