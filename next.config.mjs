/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Rise SDK (`@ellipsis-labs/rise`) ships pure ESM; transpile it so
  // Next can bundle it for both server and client. See PLAN.md §3.
  transpilePackages: ["@ellipsis-labs/rise"],
  webpack: (config) => {
    // `@privy-io/react-auth` does a guarded `await import("@farcaster/mini-app-solana")`
    // for an optional Farcaster mini-app integration we do not use. That package is
    // an optional peer dep and is not installed. Marking it `external` left a bare
    // `require("@farcaster/mini-app-solana")` in the build output, which the
    // OpenNext/Cloudflare deploy step then re-bundles with esbuild and fails to
    // resolve. Aliasing it to an empty module drops the reference entirely; the
    // import is side-effect-only and already wrapped in try/catch, so this is a
    // no-op for the code paths we actually run.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@farcaster/mini-app-solana": false,
    };
    return config;
  },
};

export default nextConfig;
