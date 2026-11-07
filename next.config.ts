import type { NextConfig } from "next";

// `next dev` against local Supabase (pnpm db:start) serves photos from
// http://127.0.0.1:54321, which next/image refuses by default (local IP).
const isDev = process.env.NODE_ENV === "development";
const localStorage = [
  new URL("http://127.0.0.1:54321/storage/v1/object/public/**"),
  new URL("http://localhost:54321/storage/v1/object/public/**"),
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Product photos live in Supabase Storage (PB-02).
    remotePatterns: [
      new URL("https://*.supabase.co/storage/v1/object/public/**"),
      ...(isDev ? localStorage : []),
    ],
    // Only in development, and only for the local Supabase patterns above.
    dangerouslyAllowLocalIP: isDev,
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
