import type { NextConfig } from "next";

// Photos come from the Supabase project the app is built against. When that is
// local Supabase (pnpm db:start, or the CI e2e job, which runs `pnpm build` +
// `pnpm start` against it), they are served from http://127.0.0.1:54321, which
// next/image refuses by default (local IP). So the local host is allowed only
// when NEXT_PUBLIC_SUPABASE_URL itself is local; deployments use
// https://<ref>.supabase.co and never allow local IPs.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const supabaseUrl = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const localSupabase = supabaseUrl !== null && LOCAL_HOSTS.has(supabaseUrl.hostname);

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Product photos live in Supabase Storage (PB-02).
    remotePatterns: [
      new URL("https://*.supabase.co/storage/v1/object/public/**"),
      ...(localSupabase ? [new URL("/storage/v1/object/public/**", supabaseUrl)] : []),
    ],
    // Only when the app is built against local Supabase, and only for its host above.
    dangerouslyAllowLocalIP: localSupabase,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
