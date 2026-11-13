import { describe, expect, it, vi } from "vitest";
import type { Reply } from "@/contract";
import { adapters } from "./adapters";
import { MAX_TEXT_BYTES, parseInstagramEvents, sendInstagram, splitUtf8, toInstagramMessages } from "./instagram";
import { sendTypingOn } from "./messenger";

const igAccount = "17841400000000001";
const ig = (messaging: unknown[], id = igAccount) => ({ object: "instagram", entry: [{ id, time: 1, messaging }] });
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("parseInstagramEvents", () => {
  it("reads a text message with the Instagram account and the shopper's IGSID", () => {
    expect(
      parseInstagramEvents(ig([{ sender: { id: "igsid-1" }, recipient: { id: igAccount }, timestamp: 1, message: { mid: "m1", text: "Váy còn size M không?" } }])),
    ).toEqual([{ type: "text", accountId: igAccount, senderId: "igsid-1", mid: "m1", text: "Váy còn size M không?" }]);
  });

  it("reads a tapped quick reply from its payload (the full text, the title may be cut)", () => {
    const events = parseInstagramEvents(
      ig([{ sender: { id: "igsid-1" }, message: { mid: "m2", text: "Size M màu Be xanh…", quick_reply: { payload: "Size M màu Be xanh" } } }]),
    );
    expect(events).toEqual([{ type: "text", accountId: igAccount, senderId: "igsid-1", mid: "m2", text: "Size M màu Be xanh" }]);
  });

  it("reads a photo as an image event", () => {
    const events = parseInstagramEvents(
      ig([{ sender: { id: "igsid-1" }, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/ig/1" } }] } }]),
    );
    expect(events).toEqual([{ type: "image", accountId: igAccount, senderId: "igsid-1", mid: "m3", imageUrls: ["https://lookaside.fbsbx.com/ig/1"] }]);
  });

  it("skips echoes, reads, reactions, unsent messages and postbacks", () => {
    expect(
      parseInstagramEvents(
        ig([
          { sender: { id: igAccount }, recipient: { id: "igsid-1" }, message: { mid: "e1", text: "Dạ", is_echo: true } },
          { sender: { id: "igsid-1" }, read: { mid: "e1" } },
          { sender: { id: "igsid-1" }, reaction: { mid: "e1", action: "react", reaction: "love", emoji: "❤" } },
          { sender: { id: "igsid-1" }, message: { mid: "d1", is_deleted: true } },
          { sender: { id: "igsid-1" }, postback: { mid: "p1", title: "Bắt đầu", payload: "GET_STARTED" } },
        ]),
      ),
    ).toEqual([]);
  });

  it("logs and skips shares, story mentions and other attachments the AI can't read", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      parseInstagramEvents(
        ig([
          { sender: { id: "igsid-1" }, message: { mid: "s1", attachments: [{ type: "share", payload: { url: "https://x/post" } }] } },
          { sender: { id: "igsid-1" }, message: { mid: "s2", attachments: [{ type: "story_mention", payload: { url: "https://x/story" } }] } },
        ]),
      ),
    ).toEqual([]);
    expect(info).toHaveBeenCalledWith("instagram: unsupported message s1 ignored");
    info.mockRestore();
  });

  it("ignores malformed items instead of throwing", () => {
    expect(parseInstagramEvents(ig([{}, { sender: {} }, { sender: { id: "igsid-1" }, message: {} }]))).toEqual([]);
    expect(parseInstagramEvents({ object: "instagram" })).toEqual([]);
  });
});

describe("splitUtf8 (Instagram's 1000-byte text limit)", () => {
  it("keeps a short text whole", () => {
    expect(splitUtf8("Dạ còn size M ạ")).toEqual(["Dạ còn size M ạ"]);
    expect(splitUtf8("")).toEqual([]);
  });

  it("splits Vietnamese text at spaces into parts of at most 1000 bytes, losing no word", () => {
    const text = "Đầm suông linen mặc mát, dễ phối đồ, phù hợp đi làm và đi chơi. ".repeat(20).trim();
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(bytes(text)).toBeGreaterThan(MAX_TEXT_BYTES);
    const parts = splitUtf8(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(bytes(part)).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    expect(parts.join(" ")).toBe(text);
  });

  it("cuts a word with no space between characters, never inside a character", () => {
    const parts = splitUtf8("ạ".repeat(500), 10);
    for (const part of parts) expect(bytes(part)).toBeLessThanOrEqual(10);
    expect(parts.join("")).toBe("ạ".repeat(500));
  });
});

describe("toInstagramMessages (design A, as on Messenger)", () => {
  const card = (n: number) => ({
    productId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    name: `Sản phẩm ${n}`,
    price: 359000,
    imageUrl: `https://x.supabase.co/storage/v1/object/public/product-images/SP${n}.jpg`,
    sizesInStock: ["S", "M"],
  });

  it("sends text, then a carousel of product cards with photos, with the quick replies on the last", () => {
    const messages = toInstagramMessages({ text: "Dạ có ạ", products: [card(1)], quickReplies: ["Đặt luôn"] });
    expect(messages).toEqual([
      { text: "Dạ có ạ" },
      {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{ title: "Sản phẩm 1", subtitle: "359.000đ · Size còn hàng: S, M", image_url: card(1).imageUrl }],
          },
        },
        quick_replies: [{ content_type: "text", title: "Đặt luôn", payload: "Đặt luôn" }],
      },
    ]);
  });

  it("keeps Instagram's limits: 1000-byte texts, 10 cards, 13 quick replies of 20 characters", () => {
    const reply = {
      text: "Áo sơ mi lụa mềm, thoáng, hợp đi làm. ".repeat(40).trim(),
      products: Array.from({ length: 12 }, (_, i) => card(i + 1)),
      quickReplies: Array.from({ length: 15 }, (_, i) => `Câu trả lời nhanh số ${i + 1} rất dài`),
    } as Reply;
    const messages = toInstagramMessages(reply);
    const texts = messages.filter((m) => "text" in m) as { text: string }[];
    expect(texts.length).toBeGreaterThan(1);
    for (const m of texts) expect(bytes(m.text)).toBeLessThanOrEqual(MAX_TEXT_BYTES);

    const carousel = messages.at(-1) as {
      attachment: { payload: { elements: unknown[] } };
      quick_replies: { title: string; payload: string }[];
    };
    expect(carousel.attachment.payload.elements).toHaveLength(10);
    expect(carousel.quick_replies).toHaveLength(13);
    for (const q of carousel.quick_replies) expect(q.title.length).toBeLessThanOrEqual(20);
    expect(carousel.quick_replies[0].payload).toBe("Câu trả lời nhanh số 1 rất dài");
  });

  it("puts the quick replies on the last text part when there are no cards", () => {
    const messages = toInstagramMessages({ text: "ạ ".repeat(600).trim(), products: [], quickReplies: ["Có, gặp nhân viên", "Không cần"] });
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.slice(0, -1).every((m) => !("quick_replies" in m))).toBe(true);
    expect(messages.at(-1)).toHaveProperty("quick_replies");
  });
});

describe("sendInstagram", () => {
  const target = {
    channel: "instagram" as const,
    externalId: "igsid-1",
    channelAccount: { id: "acc-ig", externalAccountId: igAccount, accessToken: "page-token" },
  };

  it("posts each message to the Send API with the linked Page's token, to the shopper's IGSID", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendInstagram(target, { text: "Dạ", products: [], quickReplies: ["Đặt luôn"] }, fetchMock);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v24.0/me/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer page-token");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: "igsid-1" },
      messaging_type: "RESPONSE",
      message: { text: "Dạ", quick_replies: [{ content_type: "text", title: "Đặt luôn", payload: "Đặt luôn" }] },
    });
  });

  it("throws Meta's error, named for Instagram, when the Send API refuses", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { message: "(#10) User consent is required" } }, { status: 400 }));
    await expect(sendInstagram(target, { text: "Dạ", products: [], quickReplies: [] }, fetchMock)).rejects.toThrow(
      "instagram_send_failed: 400 (#10) User consent is required",
    );
  });

  it("refuses a target with no Instagram account", async () => {
    await expect(sendInstagram({ ...target, channelAccount: null }, { text: "Dạ", products: [], quickReplies: [] })).rejects.toThrow(
      "instagram_send_failed: no Instagram account",
    );
  });

  it("is the Instagram adapter, so sendToConversation reaches Instagram (orders, takeover)", () => {
    expect(adapters.instagram).toBe(sendInstagram);
  });

  it("shows the typing indicator with the same Send API call", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendTypingOn("page-token", "igsid-1", fetchMock, "instagram");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ recipient: { id: "igsid-1" }, sender_action: "typing_on" });
  });
});
