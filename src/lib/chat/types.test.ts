import { describe, expect, it } from "vitest";
import { chatHistorySchema } from "./types";

const message = {
  id: "22222222-2222-4222-8222-222222222222",
  sender: "shopper",
  text: "Váy này còn size M không?",
  reply: null,
  createdAt: "2026-11-14T02:00:00.000Z",
};

describe("chatHistorySchema", () => {
  it("reads a message without photoUrls (a server from before PB-30) as having no photos", () => {
    const parsed = chatHistorySchema.parse({ messages: [message] });
    expect(parsed.messages[0].photoUrls).toEqual([]);
    expect(parsed.mode).toBe("ai");
  });

  it("keeps the photo URLs a message has", () => {
    const parsed = chatHistorySchema.parse({ messages: [{ ...message, photoUrls: ["https://x/a.jpg"] }], mode: "staff" });
    expect(parsed.messages[0].photoUrls).toEqual(["https://x/a.jpg"]);
  });
});
