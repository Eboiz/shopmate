import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "@/lib/engine/test/two-shops";

// PB-13 against local Supabase: a retried staff reply is stored once (the real
// unique key on messages), and take over / hand back is limited to the staff
// member's own shop by RLS alone.

const delivered = vi.fn(async () => {});
vi.mock("./adapters", () => ({ adapters: new Proxy({}, { get: () => delivered }) }));

const { sendToConversation } = await import("./send");

const db = createAdminClient();
const email = "pb13-int-staff@shopmate.local";
const password = "pb13-int-staff-password";
let staffId: string;
const reply = { text: "Dạ còn size M ạ", products: [], quickReplies: [] };

async function removeStaffUser() {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (user) await db.auth.admin.deleteUser(user.id);
}

beforeAll(async () => {
  await seedTwoShops(db);
  await removeStaffUser();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  staffId = data.user.id;
  const profile = await db.from("profiles").insert({ id: staffId, shop_id: FX.a.shop, role: "staff", full_name: "PB-13 test" });
  if (profile.error) throw profile.error;
});

afterAll(removeStaffUser);

beforeEach(async () => {
  delivered.mockClear();
  await db.from("messages").delete().in("conversation_id", [FX.a.conversation, FX.b.conversation]);
  await db.from("conversations").update({ mode: "ai" }).in("id", [FX.a.conversation, FX.b.conversation]);
});

const staffMessages = async () =>
  (await db.from("messages").select("id, sender, staff_id, client_message_id").eq("conversation_id", FX.a.conversation)).data ?? [];

describe("staff reply idempotency (PB-13)", () => {
  it("stores and delivers a retried send with the same client message id once", async () => {
    await db.from("conversations").update({ mode: "staff" }).eq("id", FX.a.conversation);
    const requestId = randomUUID();
    const sender = { from: "staff", staffId, clientMessageId: requestId } as const;

    const first = await sendToConversation(FX.a.conversation, reply, sender);
    const retry = await sendToConversation(FX.a.conversation, reply, sender);

    expect(first.ok).toBe(true);
    expect(retry).toEqual({ ok: false, messageId: first.messageId, error: "duplicate_client_message" });
    expect(await staffMessages()).toEqual([
      { id: first.messageId, sender: "staff", staff_id: staffId, client_message_id: requestId },
    ]);
    expect(delivered).toHaveBeenCalledOnce();
  });

  it("stores two sends with different ids as two messages", async () => {
    await sendToConversation(FX.a.conversation, reply, { from: "staff", staffId, clientMessageId: randomUUID() });
    await sendToConversation(FX.a.conversation, reply, { from: "staff", staffId, clientMessageId: randomUUID() });
    expect(await staffMessages()).toHaveLength(2);
  });
});

describe("take over / hand back through RLS (PB-13)", () => {
  async function signedInStaff() {
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }
  const modeOf = async (id: string) => (await db.from("conversations").select("mode").eq("id", id).single()).data?.mode;

  it("lets staff take over and hand back a conversation of their own shop", async () => {
    const staff = await signedInStaff();
    const taken = await staff.from("conversations").update({ mode: "staff" }).eq("id", FX.a.conversation).select("id");
    expect(taken.data).toHaveLength(1);
    expect(await modeOf(FX.a.conversation)).toBe("staff");

    const back = await staff.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation).select("id");
    expect(back.data).toHaveLength(1);
    expect(await modeOf(FX.a.conversation)).toBe("ai");
  });

  it("changes nothing in another shop's conversation", async () => {
    const staff = await signedInStaff();
    const result = await staff.from("conversations").update({ mode: "staff" }).eq("id", FX.b.conversation).select("id");
    expect(result.data ?? []).toHaveLength(0);
    expect(await modeOf(FX.b.conversation)).toBe("ai");
  });

  it("lets staff change only the mode column", async () => {
    const staff = await signedInStaff();
    const result = await staff
      .from("conversations")
      .update({ last_message_at: new Date(0).toISOString() })
      .eq("id", FX.a.conversation)
      .select("id");
    expect(result.error).not.toBeNull();
  });

  it("does not let staff insert messages directly; replies go through the server", async () => {
    const staff = await signedInStaff();
    const result = await staff.from("messages").insert({
      shop_id: FX.a.shop,
      conversation_id: FX.a.conversation,
      sender: "staff",
      staff_id: staffId,
      text: "x",
    });
    expect(result.error).not.toBeNull();
  });
});
