import { test } from "@playwright/test";
import net from "node:net";
import path from "node:path";

// Temporary helper (deleted after healing): the Playwright MCP test runner does
// not start the webServer from the config, so start the prebuilt app ourselves.
const ROOT = process.cwd();

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.on("error", () => resolve(false));
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    setTimeout(() => resolve(false), 1_500);
  });

test("start the app on :3000 if it is not running", async () => {
  if (await portOpen(3000)) {
    test.info().annotations.push({ type: "startapp", description: "already running" });
    return;
  }
  const { spawn } = await import("node:child_process");
  const child = spawn("node", [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3000"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await portOpen(3000)) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  test.expect(await portOpen(3000)).toBe(true, "the app did not come up on port 3000");
  test.info().annotations.push({ type: "startapp", description: "spawned next start" });
});
