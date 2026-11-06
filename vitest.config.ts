import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside React Server Components; tests run server code directly.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests need local Supabase: `pnpm test:int`.
    exclude: ["src/**/*.int.test.ts", ...configDefaults.exclude],
  },
});
