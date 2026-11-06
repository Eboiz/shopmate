import path from "node:path";
import { defineConfig } from "vitest/config";
import { testEnv } from "./vitest.env";

// Integration tests (`pnpm test:int`): they hit local Supabase and reset its
// fixture shops, so files run one at a time.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    env: testEnv(),
  },
});
