import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  parseMessengerEvents,
  sendMessenger,
  sendTypingOn,
  toMessengerMessages,
  toProductFallbackMessages,
  verifyMessengerSignature,
} from "./messenger";

const secret = "test-app-secret";
// Meta signs the body exactly as sent, with non-ASCII characters escaped.
const raw = '{"object":"page","entry":[{"id":"111","messaging":[{"sender":{"id":"u1"},"message":{"mid":"m1","text":"V\\u00e1y c\\u00f2n size M kh\\u00f4ng?"}}]}]}';
const body = new TextEncoder().encode(raw);
const sign = (bytes: Uint8Array, key = secret) =>
  `sha256=${createHmac("sha256", key).update(bytes).digest("hex")}`;

describe("verifyMessengerSignature", () => {
  it("accepts the signature Meta computes over the raw bytes", () => {
    expect(verifyMessengerSignature(body, sign(body), secret)).toBe(true);
  });

  it("rejects a missing, malformed or wrong signature", () => {
    expect(verifyMessengerSignature(body, null, secret)).toBe(false);
    expect(verifyMessengerSignature(body, "sha256=abc", secret)).toBe(false);
    expect(verifyMessengerSignature(body, sign(body).replace("sha256=", "sha1="), secret)).toBe(false);
    expect(verifyMessengerSignature(body, sign(body, "other-secret"), secret)).toBe(false);
  });

  it("rejects a body re-encoded after parsing (the escapes change the bytes)", () => {
    const reencoded = new TextEncoder().encode(JSON.stringify(JSON.parse(raw)));
    expect(verifyMessengerSignature(reencoded, sign(body), secret)).toBe(false);
  });
});

const page = (messaging: unknown[], id = "111") => ({ object: "page", entry: [{ id, time: 1, messaging }] });

describe("parseMessengerEvents", () => {
  it("reads a text message, including a tapped quick reply", () => {
    const events = parseMessengerEvents(
      page([
        { sender: { id: "u1" }, recipient: { id: "111" }, message: { mid: "m1", text: "Váy còn size M không?" } },
        { sender: { id: "u1" }, message: { mid: "m2", text: "Size M", quick_reply: { payload: "Size M" } } },
      ]),
    );
    expect(events).toEqual([
      { type: "text", accountId: "111", senderId: "u1", mid: "m1", text: "Váy còn size M không?" },
      { type: "text", accountId: "111", senderId: "u1", mid: "m2", text: "Size M" },
    ]);
  });

  it("reads photos as an image event, and treats stickers and the like button as stickers", () => {
    const events = parseMessengerEvents(
      page([
        {
          sender: { id: "u1" },
          message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://x/1.jpg" } }] },
        },
        {
          sender: { id: "u1" },
          message: { mid: "m4", sticker_id: 369239263222822, attachments: [{ type: "image", payload: { url: "https://x/like.png", sticker_id: 369239263222822 } }] },
        },
      ]),
    );
    expect(events).toEqual([
      { type: "image", accountId: "111", senderId: "u1", mid: "m3", imageUrls: ["https://x/1.jpg"] },
      { type: "sticker", accountId: "111", senderId: "u1", mid: "m4" },
    ]);
  });

  it("skips echoes of the Page's own messages, deliveries, reads and postbacks", () => {
    const events = parseMessengerEvents(
      page([
        { sender: { id: "111" }, message: { mid: "e1", text: "Dạ", is_echo: true } },
        { sender: { id: "u1" }, delivery: { mids: ["e1"] } },
        { sender: { id: "u1" }, read: { watermark: 1 } },
        { sender: { id: "u1" }, postback: { title: "Bắt đầu", payload: "GET_STARTED" } },
      ]),
    );
    expect(events).toEqual([]);
  });

  it('reads a tapped "Chọn size" card button as the shopper text in its payload (PB-22)', () => {
    const events = parseMessengerEvents(
      page([
        { sender: { id: "u1" }, timestamp: 5, postback: { mid: "p1", title: "Chọn size", payload: "Chọn size Đầm suông linen" } },
        { sender: { id: "u1" }, timestamp: 6, postback: { title: "Chọn size", payload: "Chọn size Áo sơ mi lụa" } },
      ]),
    );
    expect(events).toEqual([
      { type: "text", accountId: "111", senderId: "u1", mid: "p1", text: "Chọn size Đầm suông linen" },
      { type: "text", accountId: "111", senderId: "u1", mid: "postback:u1:6", text: "Chọn size Áo sơ mi lụa" },
    ]);
  });

  it("reads every entry and every messaging item in one delivery", () => {
    const body = {
      object: "page",
      entry: [
        { id: "111", messaging: [{ sender: { id: "u1" }, message: { mid: "a", text: "1" } }] },
        { id: "222", messaging: [{ sender: { id: "u2" }, message: { mid: "b", text: "2" } }] },
      ],
    };
    expect(parseMessengerEvents(body).map((e) => `${e.accountId}/${e.mid}`)).toEqual(["111/a", "222/b"]);
  });

  it("ignores malformed items instead of throwing", () => {
    expect(parseMessengerEvents(page([{}, { sender: {} }, { sender: { id: "u1" }, message: {} }]))).toEqual([]);
    expect(parseMessengerEvents({ object: "page" })).toEqual([]);
  });
});

describe("toMessengerMessages (design A: text, then cards, quick replies on the last)", () => {
  const card = (n: number, sizes = ["S", "M"]) => ({
    productId: `00000000-0000-4000-8000-00000000000${n}`,
    name: `Sản phẩm ${n}`,
    price: 359000,
    imageUrl: n === 2 ? null : `https://x.supabase.co/storage/v1/object/public/product-images/SP0${n}.jpg`,
    sizesInStock: sizes,
  });

  it("sends text, then one carousel of cards, with the quick replies on the carousel", () => {
    const messages = toMessengerMessages({
      text: "Bạn mặc size M là vừa ạ.",
      products: [card(1), card(2, [])],
      quickReplies: ["Size M màu Be", "Phối với gì?"],
    });
    expect(messages).toEqual([
      { text: "Bạn mặc size M là vừa ạ." },
      {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [
              {
                title: "Sản phẩm 1",
                subtitle: "359.000đ · Size còn hàng: S, M",
                image_url: card(1).imageUrl,
                buttons: [{ type: "postback", title: "Chọn size", payload: "Chọn size Sản phẩm 1" }],
              },
              { title: "Sản phẩm 2", subtitle: "359.000đ · Hết hàng" },
            ],
          },
        },
        quick_replies: [
          { content_type: "text", title: "Size M màu Be", payload: "Size M màu Be" },
          { content_type: "text", title: "Phối với gì?", payload: "Phối với gì?" },
        ],
      },
    ]);
  });

  it("puts the quick replies on the text when there are no cards, and sends nothing empty", () => {
    expect(toMessengerMessages({ text: "Dạ", products: [], quickReplies: ["Đặt luôn"] })).toEqual([
      { text: "Dạ", quick_replies: [{ content_type: "text", title: "Đặt luôn", payload: "Đặt luôn" }] },
    ]);
    expect(toMessengerMessages({ text: "Dạ", products: [], quickReplies: [] })).toEqual([{ text: "Dạ" }]);
    expect(toMessengerMessages({ text: "", products: [], quickReplies: [] })).toEqual([]);
  });

  it("cuts card titles and subtitles to Messenger's 80 characters", () => {
    const long = { ...card(1, ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL", "9XL"]), name: "Đầm ".repeat(30) };
    const [, carousel] = toMessengerMessages({ text: "x", products: [long], quickReplies: [] });
    const [element] = (carousel as { attachment: { payload: { elements: { title: string; subtitle: string }[] } } }).attachment.payload.elements;
    expect(element.title.length).toBeLessThanOrEqual(80);
    expect(element.subtitle.length).toBeLessThanOrEqual(80);
    expect(element.title.endsWith("…")).toBe(true);
  });
});

describe("carousel cards (PB-22)", () => {
  const card = (n: number, sizes = ["S", "M"]) => ({
    productId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    name: `Sản phẩm ${n}`,
    price: 359000 + n * 1000,
    imageUrl: n === 2 ? null : `https://x/SP${n}.jpg`,
    sizesInStock: sizes,
  });

  it('builds every card from products[]: photo, name, price and a "Chọn size" button, at most 10', () => {
    const products = Array.from({ length: 12 }, (_, i) => card(i + 1));
    const [carousel] = toMessengerMessages({ text: "", products, quickReplies: [] });
    const elements = (carousel as { attachment: { payload: { elements: Record<string, unknown>[] } } }).attachment.payload.elements;
    expect(elements).toHaveLength(10);
    elements.forEach((element, i) => {
      const p = products[i];
      expect(element.title).toBe(p.name);
      expect(element.subtitle).toContain(`${p.price / 1000}.000đ`);
      expect(element.image_url).toBe(p.imageUrl ?? undefined);
      expect(element.buttons).toEqual([{ type: "postback", title: "Chọn size", payload: `Chọn size ${p.name}` }]);
    });
  });

  it("falls back to each product's photo then its caption, quick replies on the last", () => {
    expect(toProductFallbackMessages({ text: "Dạ", products: [card(1), card(2, [])], quickReplies: ["Đặt luôn"] })).toEqual([
      { attachment: { type: "image", payload: { url: "https://x/SP1.jpg" } } },
      { text: "Sản phẩm 1\n360.000đ · Size còn hàng: S, M" },
      { text: "Sản phẩm 2\n361.000đ · Hết hàng", quick_replies: [{ content_type: "text", title: "Đặt luôn", payload: "Đặt luôn" }] },
    ]);
  });
});

describe("sendMessenger", () => {
  const target = {
    channel: "messenger" as const,
    externalId: "psid-1",
    channelAccount: { id: "acc", externalAccountId: "111", accessToken: "page-token" },
  };

  it("posts each message in order to the Send API with the Page's token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendMessenger(target, { text: "Dạ", products: [], quickReplies: ["Đặt luôn"] }, fetchMock);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v24.0/me/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer page-token");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: "psid-1" },
      messaging_type: "RESPONSE",
      message: { text: "Dạ", quick_replies: [{ content_type: "text", title: "Đặt luôn", payload: "Đặt luôn" }] },
    });
  });

  it("throws Meta's error without the token when the Send API refuses", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { message: "(#10) This message is sent outside of allowed window." } }, { status: 400 }),
    );
    await expect(sendMessenger(target, { text: "Dạ", products: [], quickReplies: [] }, fetchMock)).rejects.toThrow(
      "messenger_send_failed: 400 (#10) This message is sent outside of allowed window.",
    );
  });

  it("falls back to text and photos when the carousel is refused, without leaking the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { message } = JSON.parse(String(init.body)) as { message: Record<string, unknown> };
      if ((message.attachment as { type?: string } | undefined)?.type === "template") {
        return Response.json({ error: { message: "(#100) Invalid template" } }, { status: 400 });
      }
      sent.push(message);
      return new Response("{}", { status: 200 });
    });
    const reply = {
      text: "Dạ shop có 2 mẫu ạ",
      products: [
        { productId: "00000000-0000-4000-8000-000000000001", name: "Đầm A", price: 359000, imageUrl: "https://x/a.jpg", sizesInStock: ["M"] },
        { productId: "00000000-0000-4000-8000-000000000002", name: "Đầm B", price: 399000, imageUrl: null, sizesInStock: ["S"] },
      ],
      quickReplies: ["Đặt luôn"],
    };
    await sendMessenger(target, reply, fetchMock as unknown as typeof fetch);
    expect(sent).toEqual([
      { text: "Dạ shop có 2 mẫu ạ" },
      { attachment: { type: "image", payload: { url: "https://x/a.jpg" } } },
      { text: "Đầm A\n359.000đ · Size còn hàng: M" },
      { text: "Đầm B\n399.000đ · Size còn hàng: S", quick_replies: [{ content_type: "text", title: "Đặt luôn", payload: "Đặt luôn" }] },
    ]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("messenger_send_failed: 400 (#100) Invalid template");
    expect(logged).not.toContain("page-token");
    warn.mockRestore();
  });

  it("throws when the fallback is refused too, without the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const fetchMock = vi.fn(async () =>
      ++calls === 1 ? new Response("{}", { status: 200 }) : Response.json({ error: { message: "(#200) No permission" } }, { status: 403 }),
    );
    const reply = {
      text: "Dạ",
      products: [{ productId: "00000000-0000-4000-8000-000000000001", name: "Đầm A", price: 1, imageUrl: null, sizesInStock: [] }],
      quickReplies: [],
    };
    const error = await sendMessenger(target, reply, fetchMock).catch((e: Error) => e);
    expect(String(error)).toContain("messenger_send_failed: 403 (#200) No permission");
    expect(String(error)).not.toContain("page-token");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("refuses a target with no Page account", async () => {
    await expect(sendMessenger({ ...target, channelAccount: null }, { text: "Dạ", products: [], quickReplies: [] })).rejects.toThrow(
      "messenger_send_failed: no Page account",
    );
  });

  it("shows the typing indicator as its own request", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendTypingOn("page-token", "psid-1", fetchMock);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ recipient: { id: "psid-1" }, sender_action: "typing_on" });
  });
});
