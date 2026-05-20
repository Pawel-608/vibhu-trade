/**
 * OpenNext configuration for the Cloudflare Workers deployment.
 *
 * `buildCommand` is set explicitly: the npm `build` script is
 * `opennextjs-cloudflare build` (so Cloudflare's `npm run build` produces the
 * `.open-next/` worker bundle), but OpenNext's *default* build command is also
 * `npm run build` — leaving it as the default would recurse infinitely. Point
 * it straight at `next build` instead.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();
config.buildCommand = "npx next build";

export default config;
