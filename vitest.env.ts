import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Env for integration tests and the engine eval: .env.test.local holds the local
// Supabase URL and keys printed by `pnpm db:start` (and optionally ANTHROPIC_API_KEY).
export function testEnv(): Record<string, string> {
  const file = ".env.test.local";
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(file, "utf8"))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
