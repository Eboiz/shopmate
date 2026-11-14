import { beforeEach, describe, expect, it } from "vitest";
import { FX, seedTwoShops } from "@/lib/engine/test/two-shops";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveFact, dismissGaps, insertFromDraft } from "./decide";

// PB-35a owner decisions on local Supabase (secret-key client here; the page passes
// the owner's RLS client, covered by supabase/tests/pb35a_learning.test.sql).
const db = createAdminClient();
const A = FX.a.shop;
const B = FX.b.shop;
const USER = null as unknown as string; // decided_by is checked against profiles; the fixture has none

async function gap(shop: string, conversation: string) {
  const { data, error } = await db
    .from("data_gaps")
    .insert({ shop_id: shop, conversation_id: conversation, reason: "policy_not_covered", question: "Có cho kiểm hàng không?" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

describe("owner decisions", () => {
  beforeEach(() => seedTwoShops(db));

  it("a draft with a blank left is refused on the server, not only by the disabled button", async () => {
    const id = await gap(A, FX.a.conversation);
    expect(await insertFromDraft(db, { shopId: A, userId: USER, gapIds: [id], policyKind: "giao_hang", text: "Shop [có/không] cho kiểm hàng." })).toBe("blank");
    expect((await db.from("learned_facts").select("id").eq("shop_id", A)).data).toEqual([]);
  });

  it("questions of another shop are ignored", async () => {
    const other = await gap(B, FX.b.conversation);
    expect(await insertFromDraft(db, { shopId: A, userId: USER, gapIds: [other], policyKind: "giao_hang", text: "Shop có cho kiểm hàng." })).toBe("no_questions");
  });

  it("an approved draft is used at once and closes its questions", async () => {
    const ids = [await gap(A, FX.a.conversation), await gap(A, FX.a.conversation)];
    expect(await insertFromDraft(db, { shopId: A, userId: USER, gapIds: ids, policyKind: "giao_hang", text: "Shop có cho kiểm hàng trước khi nhận." })).toBe("ok");
    const { data: fact } = await db.from("learned_facts").select("id, status, policy_kind").eq("shop_id", A).single();
    expect(fact).toMatchObject({ status: "active", policy_kind: "giao_hang" });
    const { data: gaps } = await db.from("data_gaps").select("status, learned_fact_id").in("id", ids);
    expect(gaps).toEqual([
      { status: "learned", learned_fact_id: fact!.id },
      { status: "learned", learned_fact_id: fact!.id },
    ]);
  });

  it("approve moves only a pending fact; dismiss only open questions of the shop", async () => {
    const { data: fact } = await db.from("learned_facts").insert({ shop_id: A, policy_kind: "doi_tra", text: "Hàng sale không đổi.", status: "pending" }).select("id").single();
    expect(await approveFact(db, { shopId: B, factId: fact!.id, userId: USER })).toBe(false);
    expect(await approveFact(db, { shopId: A, factId: fact!.id, userId: USER })).toBe(true);
    expect(await approveFact(db, { shopId: A, factId: fact!.id, userId: USER })).toBe(false);
    const id = await gap(A, FX.a.conversation);
    expect(await dismissGaps(db, B, [id])).toBe(0);
    expect(await dismissGaps(db, A, [id])).toBe(1);
  });

  it("never turns a product detail question into a policy", async () => {
    const { data } = await db
      .from("data_gaps")
      .insert({ shop_id: A, conversation_id: FX.a.conversation, reason: "not_covered_by_data", question: "Váy này chất gì?", product_id: FX.a.vay01 })
      .select("id")
      .single();
    expect(await insertFromDraft(db, { shopId: A, userId: USER, gapIds: [data!.id], policyKind: "doi_tra", text: "Vải linen." })).toBe("no_questions");
  });
});
