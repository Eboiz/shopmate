import { after, type NextRequest } from "next/server";
import { parseMessengerEvents, sendTypingOn, verifyMessengerSignature, type MessengerEvent } from "@/lib/channels/messenger";
import { messengerPhoto } from "@/lib/channels/photo-download";
import { receiveChannelMessage } from "@/lib/channels/receive";
import { parseWhatsAppEvents, sendWhatsAppTyping, type WhatsAppEvent } from "@/lib/channels/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

// The Meta app's webhook: Messenger (PB-15) and WhatsApp (PB-27). Meta app >
// Messenger > Webhooks and Meta app > WhatsApp > Configuration both point here:
// GET verifies the callback URL, POST delivers messages. Both products sign with
// the same app secret; the payload's `object` tells them apart.

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
  if (payload?.object !== "page") return new Response(null, { status: 404 });

  const events = parseMessengerEvents(payload);
  if (events.length > 0) after(() => handleEvents(events));
  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function handleEvents(events: MessengerEvent[]) {
  const pageIds = [...new Set(events.map((e) => e.pageId))];
  const { data: accounts, error } = await createAdminClient()
    .from("channel_accounts")
    .select("id, shop_id, external_account_id, access_token")
    .eq("channel", "messenger")
    .in("external_account_id", pageIds);
  if (error) {
    console.error("messenger: channel account lookup failed", error.message);
    return;
  }

  // One at a time, so a shopper's messages are handled in the order sent.
  for (const event of events) {
    const account = accounts.find((a) => a.external_account_id === event.pageId);
    if (!account) {
      console.warn(`messenger: unknown page ${event.pageId}, message ignored`);
      continue;
    }
    if (event.type === "sticker") {
      console.info(`messenger: sticker from ${event.senderId} ignored`);
      continue;
    }
    const incoming = {
      externalId: event.senderId,
      messageId: event.mid,
      ...(event.type === "text" ? { text: event.text } : { text: "", photos: event.imageUrls.map((url) => messengerPhoto(url)) }),
    };
    try {
      await receiveChannelMessage(
        { id: account.id, shopId: account.shop_id, channel: "messenger" },
        incoming,
        () => sendTypingOn(account.access_token, event.senderId),
      );
    } catch (error) {
      console.error(`messenger: message ${event.mid} failed`, error);
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
    // conversation goes to staff with the photo notice, as before PB-30.
    const incoming = {
      externalId: event.from,
      messageId: event.messageId,
      ...(event.type === "text"
        ? { text: event.text }
        : {
            text: "",
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
