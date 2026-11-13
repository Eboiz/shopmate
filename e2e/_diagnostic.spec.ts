import { test } from "@playwright/test";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";

// Temporary helper: start the app under test (the nightly job normally starts it
// before the agent runs). Detached, so it survives this test process.
test("start the app", async ({ request }) => {
  test.setTimeout(180_000);
  const logStream = openSync("../app.log", "a");
  const errStream = openSync("../app.err.log", "a");
  const child = spawn("pnpm", ["start", "-p", "3000"], {
    detached: true,
    stdio: ["ignore", logStream, errStream],
    env: process.env,
  });
  child.unref();
  console.log(`spawned pid ${child.pid}, stdout -> ../app.log, stderr -> ../app.err.log`);
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await request.get("http://127.0.0.1:3000/login", { timeout: 2000 });
      console.log(`attempt ${attempt}: /login -> ${response.status()}`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  console.log("the app did not come up on 127.0.0.1:3000 within 180s");
});
