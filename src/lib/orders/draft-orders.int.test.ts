import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/contract";
import { assertLocalDb } from "@/lib/engine/test/two-shops";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideDraftOrder, listDraftOrders } from "./draft-orders";

// PB-12 against local Supabase, through real signed-in sessions: staff of shop A
// and owner of shop B. Fixture ids start with 12, apart from the PB-03 fixture.
const id = (n: string) => `12000000-0000-4000-8000-0000000000${n}`;
const SHOP_A = id("a1");
const SHOP_B = id("b1");
const VARIANT_M = id("21"); // stock 3
const VARIANT_S = id("22"); // stock 1
const CONVERSATION = id("31");
const ORDER_OLD = id("51"); // 2 x M + 1 x S
const ORDER_NEW = id("52"); // 2 x S
const ORDER_CANCEL = id("53"); // 1 x M
const password = "pb12-int-test-password";
const users = { staffA: "pb12-int-staff-a@test.local", staffA2: "pb12-int-staff-a2@test.local", ownerB: "pb12-int-owner-b@test.local" };

const admin = createAdminClient();
type Db = ReturnType<typeof createAdminClient>;
const sessions = {} as Record<keyof typeof users, Db>;

async function must<R extends { data: unknown; error: { message: string } | null }>(
  what: string,
  query: PromiseLike<R>,
): Promise<NonNullable<R["data"]>> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as NonNullable<R["data"]>;
}

async function deleteFixture() {
  await must("delete shops", admin.from("shops").delete().in("id", [SHOP_A, SHOP_B]));
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users.filter((u) => Object.values(users).includes(u.email ?? ""))) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

async function signIn(email: string): Promise<Db> {
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await must(`sign in ${email}`, client.auth.signInWithPassword({ email, password }));
  return client;
}

async function seedOrders() {
  await admin.from("orders").delete().eq("shop_id", SHOP_A);
  await must("variants", admin.from("variants").update({ stock: 3 }).eq("id", VARIANT_M));
  await must("variants", admin.from("variants").update({ stock: 1 }).eq("id", VARIANT_S));
  await must("messages", admin.from("messages").delete().eq("conversation_id", CONVERSATION));
  const order = (oid: string, name: string, total: number, created_at: string) => ({
    id: oid,
    shop_id: SHOP_A,
    conversation_id: CONVERSATION,
    customer_name: name,
    customer_phone: "0912345678",
    customer_address: "12 Lê Lợi, Q1",
    total,
    created_at,
  });
  await must(
    "orders",
    admin.from("orders").insert([
      order(ORDER_OLD, "Thảo", 950000, "2026-11-07T01:00:00Z"),
      order(ORDER_NEW, "Lan", 500000, "2026-11-07T02:00:00Z"),
      order(ORDER_CANCEL, "Mai", 350000, "2026-11-07T00:00:00Z"),
    ]),
  );
  await must(
    "order_items",
    admin.from("order_items").insert([
      { shop_id: SHOP_A, order_id: ORDER_OLD, variant_id: VARIANT_M, quantity: 2, unit_price: 350000 },
      { shop_id: SHOP_A, order_id: ORDER_OLD, variant_id: VARIANT_S, quantity: 1, unit_price: 250000 },
      { shop_id: SHOP_A, order_id: ORDER_NEW, variant_id: VARIANT_S, quantity: 2, unit_price: 250000 },
      { shop_id: SHOP_A, order_id: ORDER_CANCEL, variant_id: VARIANT_M, quantity: 1, unit_price: 350000 },
    ]),
  );
}

const stock = async () =>
  Object.fromEntries(
    (await must("stock", admin.from("variants").select("id, stock").eq("shop_id", SHOP_A))).map((v) => [v.id, v.stock]),
  );
const statusOf = async (oid: string) =>
  (await must("order", admin.from("orders").select("status").eq("id", oid).single())).status;

beforeAll(async () => {
  assertLocalDb();
  await deleteFixture();
  await must("shops", admin.from("shops").insert([
    { id: SHOP_A, name: "Shop A PB-12", slug: "shop-a-pb12" },
    { id: SHOP_B, name: "Shop B PB-12", slug: "shop-b-pb12" },
  ]));
  const created: Record<string, string> = {};
  for (const [key, email] of Object.entries(users)) {
    const { user } = await must(`user ${email}`, admin.auth.admin.createUser({ email, password, email_confirm: true }));
    created[key] = user!.id;
  }
  await must("profiles", admin.from("profiles").insert([
    { id: created.staffA, shop_id: SHOP_A, role: "staff" },
    { id: created.staffA2, shop_id: SHOP_A, role: "staff" },
    { id: created.ownerB, shop_id: SHOP_B, role: "owner" },
  ]));
  await must("products", admin.from("products").insert([
    { id: id("11"), shop_id: SHOP_A, code: "VAY01", name: "Váy suông linen", price: 350000 },
    { id: id("12"), shop_id: SHOP_A, code: "AO01", name: "Áo sơ mi trắng", price: 250000 },
  ]));
  await must("variants", admin.from("variants").insert([
    { id: VARIANT_M, shop_id: SHOP_A, product_id: id("11"), size: "M", color: "be", stock: 3 },
    { id: VARIANT_S, shop_id: SHOP_A, product_id: id("12"), size: "S", color: "trắng", stock: 1 },
  ]));
  await must("shoppers", admin.from("shoppers").insert([{ id: id("41"), shop_id: SHOP_A, channel: "web", external_id: "pb12-int-shopper" }]));
  await must("conversations", admin.from("conversations").insert([{ id: CONVERSATION, shop_id: SHOP_A, shopper_id: id("41") }]));
  for (const key of Object.keys(users) as (keyof typeof users)[]) sessions[key] = await signIn(users[key]);
});

afterAll(deleteFixture);
beforeEach(seedOrders);

describe("listDraftOrders", () => {
  it("lists drafts newest first with items, customer and total", async () => {
    const orders = await listDraftOrders(sessions.staffA, SHOP_A);
    expect(orders.map((o) => o.id)).toEqual([ORDER_NEW, ORDER_OLD, ORDER_CANCEL]);
    expect(orders[1]).toMatchObject({
      conversationId: CONVERSATION,
      customer: { name: "Thảo", phone: "0912345678", address: "12 Lê Lợi, Q1" },
      total: 950000,
      items: [
        { name: "Áo sơ mi trắng", size: "S", color: "trắng", quantity: 1, unitPrice: 250000 },
        { name: "Váy suông linen", size: "M", color: "be", quantity: 2, unitPrice: 350000 },
      ],
    });
  });

  it("drops orders that are no longer drafts", async () => {
    await decideDraftOrder(sessions.staffA, ORDER_CANCEL, "cancelled");
    expect((await listDraftOrders(sessions.staffA, SHOP_A)).map((o) => o.id)).toEqual([ORDER_NEW, ORDER_OLD]);
  });

  it("shows nothing of shop A to shop B, even when asked for shop A", async () => {
    expect(await listDraftOrders(sessions.ownerB, SHOP_A)).toEqual([]);
  });
});

describe("decideDraftOrder", () => {
  it("confirms, takes stock and tells the shopper in the chat", async () => {
    expect(await decideDraftOrder(sessions.staffA, ORDER_OLD, "confirmed")).toEqual({ status: "confirmed", notificationSent: true });
    expect(await statusOf(ORDER_OLD)).toBe("confirmed");
    expect(await stock()).toEqual({ [VARIANT_M]: 1, [VARIANT_S]: 0 });
    const messages = await must("messages", admin.from("messages").select("sender, text").eq("conversation_id", CONVERSATION));
    expect(messages).toEqual([{ sender: "system", text: expect.stringContaining("950.000đ") }]);
  });

  it("blocks a confirm when stock is no longer enough and writes nothing", async () => {
    expect(await decideDraftOrder(sessions.staffA, ORDER_NEW, "confirmed")).toEqual({ status: "insufficient_stock" });
    expect(await statusOf(ORDER_NEW)).toBe("draft");
    expect(await stock()).toEqual({ [VARIANT_M]: 3, [VARIANT_S]: 1 });
    expect(await must("messages", admin.from("messages").select("id").eq("conversation_id", CONVERSATION))).toEqual([]);
  });

  it("cancels without touching stock", async () => {
    expect(await decideDraftOrder(sessions.staffA, ORDER_CANCEL, "cancelled")).toEqual({ status: "cancelled", notificationSent: true });
    expect(await statusOf(ORDER_CANCEL)).toBe("cancelled");
    expect(await stock()).toEqual({ [VARIANT_M]: 3, [VARIANT_S]: 1 });
    const messages = await must("messages", admin.from("messages").select("sender, text").eq("conversation_id", CONVERSATION));
    expect(messages).toEqual([{ sender: "system", text: expect.stringContaining("hủy") }]);
  });

  it("two staff confirming at the same moment take stock once", async () => {
    const results = await Promise.all([
      decideDraftOrder(sessions.staffA, ORDER_OLD, "confirmed"),
      decideDraftOrder(sessions.staffA2, ORDER_OLD, "confirmed"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["confirmed", "not_draft"]);
    expect(await stock()).toEqual({ [VARIANT_M]: 1, [VARIANT_S]: 0 });
  });

  it("two orders racing for the last item: only one is confirmed", async () => {
    // ORDER_OLD needs the last S; make ORDER_CANCEL need all of M so both can't pass.
    await must("variants", admin.from("variants").update({ stock: 2 }).eq("id", VARIANT_M));
    const results = await Promise.all([
      decideDraftOrder(sessions.staffA, ORDER_OLD, "confirmed"),
      decideDraftOrder(sessions.staffA2, ORDER_CANCEL, "confirmed"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["confirmed", "insufficient_stock"]);
    const left = await stock();
    expect(left[VARIANT_M]).toBeGreaterThanOrEqual(0);
    expect([left[VARIANT_M], left[VARIANT_S]]).toEqual(results[0].status === "confirmed" ? [0, 0] : [1, 1]);
  });

  it("shop B cannot confirm or cancel an order of shop A", async () => {
    expect(await decideDraftOrder(sessions.ownerB, ORDER_OLD, "confirmed")).toEqual({ status: "not_found" });
    expect(await decideDraftOrder(sessions.ownerB, ORDER_CANCEL, "cancelled")).toEqual({ status: "not_found" });
    expect(await statusOf(ORDER_OLD)).toBe("draft");
    expect(await statusOf(ORDER_CANCEL)).toBe("draft");
    expect(await stock()).toEqual({ [VARIANT_M]: 3, [VARIANT_S]: 1 });
  });
});
