import { after, type NextRequest } from "next/server";
import { receiveChannelMessage } from "@/lib/channels/receive";
import {
  parseTelegramUpdate,
  sendTelegramText,
  sendTelegramTyping,
  verifyTelegramSecret,
  type TelegramEvent,
} from "@/lib/channels/telegram";
import { createAdminClient } from "@/lib/supabase/admin";

// Telegram webhook (PB-21). Updates carry no bot id, so the URL carries the
// channel_accounts row id; `pnpm db:seed --only=channels --telegram-webhook=<base>`
// registers it with setWebhook and the row's secret.

const greeting = (shop: string) => `Chào bạn! Mình là trợ lý của ${shop}. Bạn cần tìm món gì, cứ nhắn mình nhé.`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { data: account, error } = UUID.test(accountId)
    ? await createAdminClient()
        .from("channel_accounts")
        .select("id, shop_id, access_token, webhook_secret, shops(name)")
        .eq("id", accountId)
        .eq("channel", "telegram")
        .maybeSingle()
    : { data: null, error: null };
  if (error) {
    console.error("telegram: channel account lookup failed", error.message);
    return new Response(null, { status: 500 });
  }
  if (!account?.webhook_secret) {
    console.warn(`telegram: unknown account ${accountId}, update ignored`);
    return new Response(null, { status: 200 });
  }
  if (!verifyTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"), account.webhook_secret)) {
    console.warn("telegram: rejected an update with a missing or wrong secret token");
    return new Response(null, { status: 401 });
  }

  let event: TelegramEvent | null;
  try {
    event = parseTelegramUpdate(await request.json());
  } catch {
    return new Response(null, { status: 400 });
  }
  // Answer Telegram right away; it resends an update that isn't acknowledged.
  if (event) after(() => handle(account, event));
  return new Response(null, { status: 200 });
}

type Account = { id: string; shop_id: string; access_token: string; shops: { name: string } };

async function handle(account: Account, event: TelegramEvent) {
  try {
    if (event.type === "command") {
      if (event.command === "start") await sendTelegramText(account.access_token, event.chatId, greeting(account.shops.name));
      else console.info(`telegram: command /${event.command} ignored`);
      return;
    }
    if (event.type === "sticker") {
      console.info(`telegram: sticker from ${event.chatId} ignored`);
      return;
    }
    await receiveChannelMessage(
      { id: account.id, shopId: account.shop_id, channel: "telegram" },
      {
        externalId: event.chatId,
        messageId: event.updateId,
        ...(event.type === "text" ? { text: event.text } : { imageUrls: [`tg-file:${event.fileId}`] }),
      },
      () => sendTelegramTyping(account.access_token, event.chatId),
    );
  } catch (error) {
    console.error(`telegram: update ${event.updateId} failed`, error);
  }
}
