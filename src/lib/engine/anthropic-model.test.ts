import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ModelClient } from "./engine";
import { backupConfig, shouldUseBackup, withBackup } from "./anthropic-model";

type Params = Parameters<ModelClient["create"]>[0];
const params = { model: "claude-haiku-5-5", max_tokens: 10, messages: [] } as unknown as Params;
const message = { id: "msg_1" } as unknown as Anthropic.Message;

function apiError(status: number) {
  return Anthropic.APIError.generate(status, { error: { type: "x", message: "x" } }, "x", new Headers());
}

function fake(result: Anthropic.Message | Error): ModelClient & { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(async () => (result instanceof Error ? Promise.reject(result) : result)) };
}

describe("shouldUseBackup", () => {
  it("switches on quota, gateway errors, a down gateway and a rejected gateway key", () => {
    for (const status of [429, 500, 502, 503, 529, 401, 403]) expect(shouldUseBackup(apiError(status))).toBe(true);
    expect(shouldUseBackup(new Anthropic.APIConnectionError({ message: "ECONNREFUSED" }))).toBe(true);
  });

  it("does not switch on a bad request: the backup would reject it too", () => {
    for (const status of [400, 404, 413]) expect(shouldUseBackup(apiError(status))).toBe(false);
    expect(shouldUseBackup(new Error("boom"))).toBe(false);
  });
});

describe("withBackup", () => {
  it("uses the primary when it answers, without touching the backup", async () => {
    const primary = fake(message);
    const backup = fake(message);
    await expect(withBackup(primary, backup, () => {}).create(params)).resolves.toBe(message);
    expect(backup.create).not.toHaveBeenCalled();
  });

  it("sends the same request to the backup when the gateway is out of quota", async () => {
    const primary = fake(apiError(429));
    const backup = fake(message);
    const onSwitch = vi.fn();
    const onFirstToken = vi.fn();
    await expect(withBackup(primary, backup, onSwitch).create(params, { onFirstToken })).resolves.toBe(message);
    expect(backup.create).toHaveBeenCalledWith(params, { onFirstToken });
    expect(onSwitch).toHaveBeenCalledWith(429);
  });

  it("rethrows a bad request instead of calling the backup", async () => {
    const primary = fake(apiError(400));
    const backup = fake(message);
    await expect(withBackup(primary, backup, () => {}).create(params)).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(backup.create).not.toHaveBeenCalled();
  });

  it("surfaces the backup's own error, so a 429 there still stops the eval", async () => {
    const primary = fake(apiError(429));
    const backup = fake(apiError(429));
    await expect(withBackup(primary, backup, () => {}).create(params)).rejects.toBeInstanceOf(Anthropic.RateLimitError);
  });
});

describe("backupConfig", () => {
  it("is off without ANTHROPIC_BACKUP_API_KEY", () => {
    expect(backupConfig({})).toBeNull();
    expect(backupConfig({ ANTHROPIC_BACKUP_API_KEY: "  " })).toBeNull();
  });

  it("reads the key and an optional URL, trimming /v1/messages like the primary", () => {
    expect(backupConfig({ ANTHROPIC_BACKUP_API_KEY: "k" })).toEqual({ apiKey: "k" });
    expect(backupConfig({ ANTHROPIC_BACKUP_API_KEY: "k", ANTHROPIC_BACKUP_API_URL: "https://gw.example/v1/messages/" })).toEqual({
      apiKey: "k",
      baseURL: "https://gw.example",
    });
  });
});
