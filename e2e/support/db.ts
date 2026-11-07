import { expect } from "@playwright/test";
import { db } from "./env";
import type { Database } from "../../src/contract/database.types";

// Read-back helpers for the local database of the nightly job.
function client() {
  if (!db) throw new Error("no local database");
  return db;
}

export async function shopIdBySlug(slug: string) {
  const { data, error } = await client().from("shops").select("id").eq("slug", slug).single();
  if (error) throw error;
  return data.id;
}

export async function telegramAccountId(shopId: string) {
  const { data, error } = await client()
    .from("channel_accounts")
    .select("id")
    .eq("shop_id", shopId)
    .eq("channel", "telegram")
    .single();
  if (error) throw error;
  return data.id;
}

export type StoredConversation = {
  shopId: string;
  mode: string;
  messages: { sender: string; text: string }[];
};

// The shopper's conversation, or null when nothing was stored for them.
export async function conversationOf(channel: "messenger" | "telegram", externalId: string): Promise<StoredConversation | null> {
  const { data, error } = await client()
    .from("shoppers")
    .select("shop_id, conversations(id, mode, messages(sender, text, created_at))")
    .eq("channel", channel)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw error;
  // One conversation per shopper (unique shopper_id), returned as a one-item list.
  const conversation = data?.conversations[0];
  if (!data || !conversation) return null;
  const messages = [...conversation.messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { shopId: data.shop_id, mode: conversation.mode, messages: messages.map(({ sender, text }) => ({ sender, text })) };
}

// Webhooks answer 200 first and work in after(): wait until the shopper's
// conversation reaches the expected state.
export async function waitForConversation(
  channel: "messenger" | "telegram",
  externalId: string,
  done: (c: StoredConversation) => boolean,
) {
  let last: StoredConversation | null = null;
  await expect
    .poll(async () => {
      last = await conversationOf(channel, externalId);
      return last !== null && done(last);
    }, { timeout: 20_000 })
    .toBe(true);
  return last as unknown as StoredConversation;
}

// For "nothing happens" cases: give after() time to run, then check.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 3_000));

// How many channel_events rows exist for one (account, external message id, shop):
// the dedupe log. A message delivered N times leaves exactly 1 row.
export async function channelEventsCount(accountId: string, externalMessageId: string, shopId: string): Promise<number> {
  const { data, error } = await client()
    .from("channel_events")
    .select("id")
    .match({ channel_account_id: accountId, external_message_id: externalMessageId, shop_id: shopId });
  if (error) throw error;
  return (data ?? []).length;
}

// A fresh channel account for a shop that has none (e.g. the eval twin), used to
// test one external chat id shared across two shops. The table is unique on
// (channel, external_account_id), so the caller passes a bot id no other row uses.
export async function insertChannelAccount(input: {
  shopId: string;
  channel: Database["public"]["Enums"]["channel"];
  externalAccountId: string;
  accessToken: string;
  webhookSecret: string;
}): Promise<string> {
  const { data, error } = await client()
    .from("channel_accounts")
    .insert({
      shop_id: input.shopId,
      channel: input.channel,
      external_account_id: input.externalAccountId,
      access_token: input.accessToken,
      webhook_secret: input.webhookSecret,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// A channel account row, including the secret used to sign its webhook.
export async function channelAccountOf(accountId: string) {
  const { data, error } = await client()
    .from("channel_accounts")
    .select("id, shop_id, channel, external_account_id, webhook_secret")
    .eq("id", accountId)
    .single();
  if (error) throw error;
  return data;
}

// Deleting a channel account cascades to the shoppers, channel_events,
// conversations and messages it produced, so a throwaway account's data is
// removed in one statement.
export async function removeChannelAccount(accountId: string, shopId: string) {
  const { error } = await client()
    .from("channel_accounts")
    .delete()
    .match({ id: accountId, shop_id: shopId });
  if (error) throw error;
}

// The same external chat id can belong to two shops (one shopper each). The
// single-row conversationOf() would error here, so read every shop's rows.
export async function conversationsForExternalId(channel: "messenger" | "telegram", externalId: string) {
  const { data, error } = await client()
    .from("shoppers")
    .select("shop_id, conversations(id, mode, messages(sender, text, created_at))")
    .eq("channel", channel)
    .eq("external_id", externalId);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const conversation = row.conversations?.[0];
    const messages = [...(conversation?.messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { shopId: row.shop_id, mode: conversation?.mode, messages: messages.map(({ sender, text }) => ({ sender, text })) };
  });
}
