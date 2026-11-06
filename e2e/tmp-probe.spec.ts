import { test } from "@playwright/test";
import net from "node:net";
import os from "node:os";

test("scan", async ({ request }) => {
  try {
    const res = await request.get("http://localhost:3000/login", { timeout: 10_000 });
    console.log(`login -> ${res.status()}`);
  } catch (e) {
    console.log(`login -> ${(e as Error).message.split("\n")[0]}`);
  }
  try {
    const res = await request.get("http://localhost:3000/may-boutique", { timeout: 10_000 });
    console.log(`shop -> ${res.status()}`);
  } catch (e) {
    console.log(`shop -> ${(e as Error).message.split("\n")[0]}`);
  }
});
