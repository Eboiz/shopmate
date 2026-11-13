import type { Reply } from "@/contract";
import { formatPrice, formatSizesInStock } from "@/lib/format";
import type { DeliveryTarget } from "./adapters";

// WhatsApp Cloud API (PB-27): payload parsing and sending. Deliveries come on the
// same Meta webhook as Messenger (object = "whatsapp_business_account"), signed
// with the same app secret, so the signature check is verifyMessengerSignature.
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

type Base = { phoneNumberId: string; from: string; messageId: string };
export type WhatsAppEvent =
  | (Base & { type: "text"; text: string })
  | (Base & { type: "image"; mediaId: string });

type Message = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  button?: { text?: string };
  image?: { id?: string };
};
type Change = {
  field?: string;
  value?: {
    metadata?: { phone_number_id?: string };
    messages?: Message[];
    statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string }[] }[];
  };
};

// The shopper's words in a message: typed text, or the title of a tapped reply
// button or list row (we send the quick reply text as both its id and title).
function textOf(message: Message): string | undefined {
  if (message.type === "text") return message.text?.body;
  if (message.type === "interactive") {
    const tapped = message.interactive?.button_reply ?? message.interactive?.list_reply;
    return tapped?.title ?? tapped?.id;
  }
  // A template's quick reply button (not sent by ShopMate, but reads the same way).
  if (message.type === "button") return message.button?.text;
  return undefined;
}

// Shopper messages only. Status callbacks (sent, delivered, read) are skipped; a
// failed one is logged, since that is where WhatsApp reports a refused send.
export function parseWhatsAppEvents(body: unknown): WhatsAppEvent[] {
  const entries = (body as { entry?: { changes?: Change[] }[] })?.entry ?? [];
  const events: WhatsAppEvent[] = [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (change.field !== "messages" || !phoneNumberId) continue;
      for (const status of value.statuses ?? []) {
        if (status.status === "failed") {
          const error = status.errors?.[0];
          console.warn(`whatsapp: message ${status.id} not delivered: ${error?.code ?? ""} ${error?.title ?? ""}`.trim());
        }
      }
      for (const message of value.messages ?? []) {
        if (!message.from || !message.id) continue;
        const base = { phoneNumberId, from: message.from, messageId: message.id };
        const text = textOf(message);
        if (text) events.push({ ...base, type: "text", text });
        else if (message.type === "image" && message.image?.id) events.push({ ...base, type: "image", mediaId: message.image.id });
        else console.info(`whatsapp: unsupported ${message.type ?? "unknown"} message ${message.id} ignored`);
      }
    }
  }
  return events;
}

// Graph API version, the same one the Messenger Send API uses.
const GRAPH_API = "https://graph.facebook.com/v24.0";
// WhatsApp limits: 3 reply buttons, 20 characters per button title, 10 list rows of
// 24 characters, 1024 characters of caption or interactive body.
export const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE = 20;
const MAX_ROWS = 10;
const MAX_ROW_TITLE = 24;
const MAX_BODY = 1024;
// Shown when the quick replies need a message of their own (a list after a photo).
export const QUICK_REPLY_PROMPT = "Bạn chọn nhanh ở đây nhé:";
export const LIST_BUTTON = "Chọn nhanh";

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

type Outgoing = Record<string, unknown> & { type: string };

// Design A (PB-27, as on Messenger and Telegram): text, then each product card as
// a photo with its name, price and sizes as the caption (text when it has no
// photo). Quick replies become reply buttons on the last message (up to 3; a
// photo becomes the buttons' header), or a list when there are more. Tapping one
// sends its title as the shopper's message.
export function toWhatsAppMessages(reply: Reply): Outgoing[] {
  const messages: Outgoing[] = [];
  if (reply.text) messages.push({ type: "text", text: { body: reply.text, preview_url: false } });
  for (const p of reply.products) {
    const caption = cut(`${p.name}\n${formatPrice(p.price)} · ${formatSizesInStock(p.sizesInStock)}`, MAX_BODY);
    messages.push(
      p.imageUrl
        ? { type: "image", image: { link: p.imageUrl, caption } }
        : { type: "text", text: { body: caption, preview_url: false } },
    );
  }

  // WhatsApp refuses two buttons or rows with the same id, so cut first, then dedupe.
  const asButtons = reply.quickReplies.length <= MAX_BUTTONS;
  const titles = [
    ...new Set(reply.quickReplies.map((q) => cut(q, asButtons ? MAX_BUTTON_TITLE : MAX_ROW_TITLE))),
  ].slice(0, MAX_ROWS);
  if (titles.length === 0) return messages;

  const action = asButtons
    ? { buttons: titles.map((title) => ({ type: "reply", reply: { id: title, title } })) }
    : { button: LIST_BUTTON, sections: [{ rows: titles.map((title) => ({ id: title, title })) }] };
  const interactive = (body: string, header?: unknown) => ({
    type: "interactive",
    interactive: { type: asButtons ? "button" : "list", ...(header ? { header } : {}), body: { text: cut(body, MAX_BODY) }, action },
  });

  const last = messages.at(-1) as { type: string; text?: { body: string }; image?: { link: string; caption: string } } | undefined;
  if (last?.type === "text" && last.text) messages[messages.length - 1] = interactive(last.text.body);
  else if (last?.type === "image" && last.image && asButtons) {
    messages[messages.length - 1] = interactive(last.image.caption, { type: "image", image: { link: last.image.link } });
  } else messages.push(interactive(QUICK_REPLY_PROMPT));
  return messages;
}

async function callGraphApi(phoneNumberId: string, token: string, body: unknown, fetchFn: typeof fetch) {
  const response = await fetchFn(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(`whatsapp_send_failed: ${response.status} ${detail?.error?.message ?? ""}`.trim());
}

// The WhatsApp channel adapter: sends each message in order from the shop's
// phone number (channel account external id) with its access token.
export async function sendWhatsApp(target: DeliveryTarget, reply: Reply, fetchFn: typeof fetch = fetch) {
  const account = target.channelAccount;
  if (!account?.accessToken) throw new Error("whatsapp_send_failed: no phone number account");
  for (const message of toWhatsAppMessages(reply)) {
    await callGraphApi(
      account.externalAccountId,
      account.accessToken,
      { messaging_product: "whatsapp", recipient_type: "individual", to: target.externalId, ...message },
      fetchFn,
    );
  }
}

// Marks the shopper's message as read and shows "typing…" until the reply is
// sent (or about 25 seconds).
export function sendWhatsAppTyping(phoneNumberId: string, token: string, messageId: string, fetchFn: typeof fetch = fetch) {
  return callGraphApi(
    phoneNumberId,
    token,
    { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } },
    fetchFn,
  );
}
