import { describe, expect, it, vi } from "vitest";
import { adapters } from "./adapters";
import { LIST_BUTTON, QUICK_REPLY_PROMPT, parseWhatsAppEvents, sendWhatsApp, sendWhatsAppTyping, toWhatsAppMessages } from "./whatsapp";

// A Cloud API delivery as Meta sends it: one entry per WhatsApp Business Account,
// one change per field, the business phone number in metadata.
const delivery = (value: Record<string, unknown>, phoneNumberId = "PN1") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550001111", phone_number_id: phoneNumberId },
            ...value,
          },
        },
      ],
    },
  ],
});
const contacts = [{ profile: { name: "Thảo" }, wa_id: "84901234567" }];

describe("parseWhatsAppEvents", () => {
  it("reads a text message", () => {
    const events = parseWhatsAppEvents(
      delivery({
        contacts,
        messages: [{ from: "84901234567", id: "wamid.1", timestamp: "1", type: "text", text: { body: "Váy còn size M không?" } }],
      }),
    );
    expect(events).toEqual([
      { type: "text", phoneNumberId: "PN1", from: "84901234567", messageId: "wamid.1", text: "Váy còn size M không?" },
    ]);
  });

  it("reads a tapped reply button or list row as the shopper's text", () => {
    const events = parseWhatsAppEvents(
      delivery({
        contacts,
        messages: [
          {
            from: "84901234567",
            id: "wamid.2",
            type: "interactive",
            context: { from: "15550001111", id: "wamid.out" },
            interactive: { type: "button_reply", button_reply: { id: "Size M", title: "Size M" } },
          },
          {
            from: "84901234567",
            id: "wamid.3",
            type: "interactive",
            interactive: { type: "list_reply", list_reply: { id: "Phối với gì?", title: "Phối với gì?" } },
          },
          { from: "84901234567", id: "wamid.4", type: "button", button: { text: "Đặt luôn", payload: "Đặt luôn" } },
        ],
      }),
    );
    expect(events.map((e) => (e.type === "text" ? e.text : null))).toEqual(["Size M", "Phối với gì?", "Đặt luôn"]);
  });

  it("reads a photo as an image event with its media id", () => {
    const events = parseWhatsAppEvents(
      delivery({ messages: [{ from: "84901234567", id: "wamid.5", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }] }),
    );
    expect(events).toEqual([{ type: "image", phoneNumberId: "PN1", from: "84901234567", messageId: "wamid.5", mediaId: "MEDIA1" }]);
  });

  it("ignores status callbacks, and logs a failed send", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = parseWhatsAppEvents(
      delivery({
        statuses: [
          { id: "wamid.out1", status: "delivered", recipient_id: "84901234567" },
          { id: "wamid.out2", status: "read", recipient_id: "84901234567" },
          { id: "wamid.out3", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
        ],
      }),
    );
    expect(events).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("whatsapp: message wamid.out3 not delivered: 131047 Re-engagement message");
    warn.mockRestore();
  });

  it("logs and skips stickers, voice notes and other message types", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const events = parseWhatsAppEvents(
      delivery({
        messages: [
          { from: "84901234567", id: "wamid.6", type: "sticker", sticker: { id: "S1" } },
          { from: "84901234567", id: "wamid.7", type: "audio", audio: { id: "A1" } },
        ],
      }),
    );
    expect(events).toEqual([]);
    expect(info).toHaveBeenCalledWith("whatsapp: unsupported sticker message wamid.6 ignored");
    info.mockRestore();
  });

  it("ignores other fields and malformed items instead of throwing", () => {
    expect(parseWhatsAppEvents({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: {} }] }] })).toEqual([]);
    expect(parseWhatsAppEvents(delivery({ messages: [{}, { from: "8490" }, { id: "x" }] }))).toEqual([]);
    expect(parseWhatsAppEvents({ object: "whatsapp_business_account" })).toEqual([]);
    expect(parseWhatsAppEvents(null)).toEqual([]);
  });
});

describe("toWhatsAppMessages (design A: text, then photos, quick replies on the last)", () => {
  const card = (n: number, sizes = ["S", "M"]) => ({
    productId: `00000000-0000-4000-8000-00000000000${n}`,
    name: `Sản phẩm ${n}`,
    price: 359000,
    imageUrl: n === 2 ? null : `https://x.supabase.co/storage/v1/object/public/product-images/SP0${n}.jpg`,
    sizesInStock: sizes,
  });

  it("sends text, then each product as a captioned photo (text when it has no photo)", () => {
    expect(toWhatsAppMessages({ text: "Dạ có ạ.", products: [card(1), card(2, [])], quickReplies: [] })).toEqual([
      { type: "text", text: { body: "Dạ có ạ.", preview_url: false } },
      { type: "image", image: { link: card(1).imageUrl, caption: "Sản phẩm 1\n359.000đ · Size còn hàng: S, M" } },
      { type: "text", text: { body: "Sản phẩm 2\n359.000đ · Hết hàng", preview_url: false } },
    ]);
  });

  it("turns the last text into reply buttons when there are up to 3 quick replies", () => {
    expect(toWhatsAppMessages({ text: "Bạn mặc size M là vừa ạ.", products: [], quickReplies: ["Size M", "Đặt luôn"] })).toEqual([
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Bạn mặc size M là vừa ạ." },
          action: {
            buttons: [
              { type: "reply", reply: { id: "Size M", title: "Size M" } },
              { type: "reply", reply: { id: "Đặt luôn", title: "Đặt luôn" } },
            ],
          },
        },
      },
    ]);
  });

  it("puts the buttons under the last product photo, with the photo as header", () => {
    const messages = toWhatsAppMessages({ text: "Mẫu này ạ", products: [card(1)], quickReplies: ["Size M", "Size L", "Phối với gì?"] });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "image", image: { link: card(1).imageUrl } },
        body: { text: "Sản phẩm 1\n359.000đ · Size còn hàng: S, M" },
        action: {
          buttons: ["Size M", "Size L", "Phối với gì?"].map((t) => ({ type: "reply", reply: { id: t, title: t } })),
        },
      },
    });
  });

  it("uses a list for more than 3 quick replies, as its own message after a photo", () => {
    const quickReplies = ["Size S", "Size M", "Size L", "Size XL"];
    const messages = toWhatsAppMessages({ text: "", products: [card(1)], quickReplies });
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("image");
    expect(messages[1]).toEqual({
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: QUICK_REPLY_PROMPT },
        action: { button: LIST_BUTTON, sections: [{ rows: quickReplies.map((t) => ({ id: t, title: t })) }] },
      },
    });
  });

  it("puts a list on the last text message", () => {
    const [message] = toWhatsAppMessages({ text: "Bạn chọn size nhé", products: [], quickReplies: ["XS", "S", "M", "L", "XL"] });
    expect(message).toMatchObject({ type: "interactive", interactive: { type: "list", body: { text: "Bạn chọn size nhé" } } });
  });

  it("cuts button titles to 20 characters and drops duplicates", () => {
    // The shared schema already caps quick replies at 20; this guards the WhatsApp limit itself.
    const long = "Váy hoa nhí cổ vuông tay phồng";
    const [message] = toWhatsAppMessages({ text: "x", products: [], quickReplies: [long, long, "Size M"] });
    const buttons = (message as unknown as { interactive: { action: { buttons: { reply: { id: string; title: string } }[] } } }).interactive.action.buttons;
    expect(buttons).toHaveLength(2);
    expect(buttons[0].reply.title).toHaveLength(20);
    expect(buttons[0].reply.title.endsWith("…")).toBe(true);
    expect(buttons[0].reply.id).toBe(buttons[0].reply.title);
  });

  it("sends nothing for an empty reply, and a prompt when only quick replies are left", () => {
    expect(toWhatsAppMessages({ text: "", products: [], quickReplies: [] })).toEqual([]);
    expect(toWhatsAppMessages({ text: "", products: [], quickReplies: ["Có, gặp nhân viên"] })).toEqual([
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: QUICK_REPLY_PROMPT },
          action: { buttons: [{ type: "reply", reply: { id: "Có, gặp nhân viên", title: "Có, gặp nhân viên" } }] },
        },
      },
    ]);
  });
});

describe("sendWhatsApp", () => {
  const target = {
    channel: "whatsapp" as const,
    externalId: "84901234567",
    channelAccount: { id: "acc", externalAccountId: "PN1", accessToken: "wa-token" },
  };

  it("posts each message in order from the shop's phone number with its token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendWhatsApp(
      target,
      {
        text: "Dạ",
        products: [{ productId: "00000000-0000-4000-8000-000000000001", name: "Váy", price: 1000, imageUrl: "https://x/1.jpg", sizesInStock: ["M"] }],
        quickReplies: [],
      },
      fetchMock,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://graph.facebook.com/v24.0/PN1/messages");
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer wa-token");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "84901234567",
      type: "text",
      text: { body: "Dạ", preview_url: false },
    });
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({ to: "84901234567", type: "image" });
  });

  it("throws Meta's error without the token when the Cloud API refuses", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { message: "(#131030) Recipient phone number not in allowed list" } }, { status: 400 }),
    );
    const sent = sendWhatsApp(target, { text: "Dạ", products: [], quickReplies: [] }, fetchMock);
    await expect(sent).rejects.toThrow("whatsapp_send_failed: 400 (#131030) Recipient phone number not in allowed list");
    await expect(sent).rejects.not.toThrow("wa-token");
  });

  it("refuses a target with no phone number account", async () => {
    await expect(sendWhatsApp({ ...target, channelAccount: null }, { text: "Dạ", products: [], quickReplies: [] })).rejects.toThrow(
      "whatsapp_send_failed: no phone number account",
    );
  });

  it("marks the message read with a typing indicator", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendWhatsAppTyping("PN1", "wa-token", "wamid.1", fetchMock);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v24.0/PN1/messages");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.1",
      typing_indicator: { type: "text" },
    });
  });
});

describe("adapters.whatsapp", () => {
  it("is the WhatsApp sender, so sendToConversation reaches WhatsApp shoppers (PB-11, PB-12, PB-13)", () => {
    expect(adapters.whatsapp).toBe(sendWhatsApp);
  });
});
