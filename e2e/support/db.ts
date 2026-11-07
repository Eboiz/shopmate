import { expect } from "@playwright/test";
import { db } from "./env";

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
