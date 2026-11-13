import { after, type NextRequest } from "next/server";
import { parseInstagramEvents } from "@/lib/channels/instagram";
import { parseMessengerEvents, sendTypingOn, verifyMessengerSignature, type MessagingEvent } from "@/lib/channels/messenger";
import { messengerPhoto } from "@/lib/channels/photo-download";
import { receiveChannelMessage } from "@/lib/channels/receive";
import { parseWhatsAppEvents, sendWhatsAppTyping, type WhatsAppEvent } from "@/lib/channels/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

// The Meta app's webhook: Messenger (PB-15), Instagram Direct (PB-23) and WhatsApp
// (PB-27). The webhook settings of all three products point here: GET verifies the
// callback URL, POST delivers messages. All sign with the same app secret; the
// payload's `object` (page, instagram, whatsapp_business_account) tells them apart.

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (token && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === token) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("messenger: META_APP_SECRET is not set");
    return new Response(null, { status: 500 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (!verifyMessengerSignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    // Every real delivery failing here means META_APP_SECRET doesn't match the Meta app.
    console.warn("messenger: rejected a delivery with a missing or wrong signature");
    return new Response(null, { status: 401 });
  }
  let payload: { object?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response(null, { status: 400 });
  }
  // Answer Meta right away; Meta resends a delivery that isn't acknowledged quickly.
  if (payload?.object === "whatsapp_business_account") {
    const events = parseWhatsAppEvents(payload);
    if (events.length > 0) after(() => handleWhatsAppEvents(events));
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
  if (payload?.object === "instagram") {
    const events = parseInstagramEvents(payload);
    if (events.length > 0) after(() => handleEvents("instagram", events));
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
  if (payload?.object !== "page") return new Response(null, { status: 404 });

  const events = parseMessengerEvents(payload);
  if (events.length > 0) after(() => handleEvents("messenger", events));
  return new Response("EVENT_RECEIVED", { status: 200 });
}

// Messenger and Instagram: the same messaging events, the account being a Page ID
// or an Instagram professional account ID, and the same Send API (typing indicator).
async function handleEvents(channel: "messenger" | "instagram", events: MessagingEvent[]) {
  const accountIds = [...new Set(events.map((e) => e.accountId))];
  const { data: accounts, error } = await createAdminClient()
    .from("channel_accounts")
    .select("id, shop_id, external_account_id, access_token")
    .eq("channel", channel)
    .in("external_account_id", accountIds);
  if (error) {
    console.error(`${channel}: channel account lookup failed`, error.message);
    return;
  }

  // One at a time, so a shopper's messages are handled in the order sent.
  for (const event of events) {
    const account = accounts.find((a) => a.external_account_id === event.accountId);
    if (!account) {
      console.warn(`${channel}: unknown ${channel === "messenger" ? "page" : "account"} ${event.accountId}, message ignored`);
      continue;
    }
    if (event.type === "sticker") {
      console.info(`${channel}: sticker from ${event.senderId} ignored`);
      continue;
    }
    const incoming = {
      externalId: event.senderId,
      messageId: event.mid,
      ...(event.type === "text" ? { text: event.text } : { text: "", photos: event.imageUrls.map((url) => messengerPhoto(url)) }),
    };
    try {
      await receiveChannelMessage(
        { id: account.id, shopId: account.shop_id, channel },
        incoming,
        () => sendTypingOn(account.access_token, event.senderId, fetch, channel),
      );
    } catch (error) {
      console.error(`${channel}: message ${event.mid} failed`, error);
    }
  }
}

async function handleWhatsAppEvents(events: WhatsAppEvent[]) {
  const phoneNumberIds = [...new Set(events.map((e) => e.phoneNumberId))];
  const { data: accounts, error } = await createAdminClient()
    .from("channel_accounts")
    .select("id, shop_id, external_account_id, access_token")
    .eq("channel", "whatsapp")
    .in("external_account_id", phoneNumberIds);
  if (error) {
    console.error("whatsapp: channel account lookup failed", error.message);
    return;
  }

  // One at a time, so a shopper's messages are handled in the order sent.
  for (const event of events) {
    const account = accounts.find((a) => a.external_account_id === event.phoneNumberId);
    if (!account) {
      console.warn(`whatsapp: unknown phone number ${event.phoneNumberId}, message ignored`);
      continue;
    }
    // A photo arrives as a media id. PB-30 downloads web, Messenger and Telegram
    // photos only, so a WhatsApp photo is "a photo that could not be kept": the
    // conversation goes to staff with the photo notice, as before PB-30, and the
    // stored text keeps the media id for staff.
    const incoming = {
      externalId: event.from,
      messageId: event.messageId,
      ...(event.type === "text"
        ? { text: event.text }
        : {
            text: "",
            photoRefs: [`whatsapp-media:${event.mediaId}`],
            photos: [async () => {
              throw new Error(`whatsapp media ${event.mediaId} is not downloaded`);
            }],
          }),
    };
    try {
      await receiveChannelMessage(
        { id: account.id, shopId: account.shop_id, channel: "whatsapp" },
        incoming,
        () => sendWhatsAppTyping(account.external_account_id, account.access_token, event.messageId),
      );
    } catch (error) {
      console.error(`whatsapp: message ${event.messageId} failed`, error);
    }
  }
}
