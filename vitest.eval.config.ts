import path from "node:path";
import { defineConfig } from "vitest/config";
import { productionDefaults } from "./src/lib/engine/eval/eval-env";
import { testEnv } from "./vitest.env";

// `pnpm engine:eval`: the engine against real Claude on local Supabase. Costs
// real money on every run; CI never runs it. Runs like production: Haiku and the
// Jev router, unless the shell sets ANTHROPIC_MODEL or JEV_IN_TESTS=false.
const fileEnv = testEnv();
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
    // `pnpm eval:injection` builds the env itself (local Supabase only, see
    // src/lib/engine/eval/eval-env.ts); .env.test.local must not override it.
    env: process.env.EVAL_ENV_FROM_RUNNER === "1" ? {} : { ...fileEnv, ...productionDefaults(process.env, fileEnv) },
  },
});
