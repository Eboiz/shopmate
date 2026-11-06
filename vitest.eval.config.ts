import path from "node:path";
import { defineConfig } from "vitest/config";
import { testEnv } from "./vitest.env";

// `pnpm engine:eval`: the engine against real Claude on local Supabase. Costs
// real money on every run; CI never runs it.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["src/**/*.eval.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    env: testEnv(),
  },
});
