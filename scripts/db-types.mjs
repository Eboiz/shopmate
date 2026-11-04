// Regenerates src/contract/database.types.ts from the local Supabase database.
// Writes the file only when generation succeeds, so a stopped database never
// leaves an empty types file behind (a shell `>` would).
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const types = execSync("supabase gen types typescript --local --schema public", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (!types.includes("export type Database")) {
  console.error("supabase gen types returned no types; is `pnpm db:start` running?");
  process.exit(1);
}
writeFileSync(new URL("../src/contract/database.types.ts", import.meta.url), types);
console.log("Wrote src/contract/database.types.ts");
