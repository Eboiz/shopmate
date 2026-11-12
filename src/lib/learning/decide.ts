import { hasBlank, type PolicyKind } from "@/contract";
import type { Db } from "@/lib/engine/types";

// PB-35a: what the owner decides on the "AI đã học" page. The server actions pass
// the signed-in user's client, so RLS (owner only, own shop) guards every update;
// insertFromDraft is the one exception (inserts are server only) and its action
// checks the owner itself. Every call filters by shopId too.

type Who = { shopId: string; userId: string };
const decided = (userId: string) => ({ decided_by: userId, decided_at: new Date().toISOString() });

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

async function must<T>(what: string, run: Result<T>): Promise<NonNullable<T>> {
  const { data, error } = await run;
  if (error || data == null) throw new Error(`${what}: ${error?.message ?? "no data"}`);
  return data;
}

// A write that returns no rows.
async function exec(what: string, run: Result<unknown>): Promise<void> {
  const { error } = await run;
  if (error) throw new Error(`${what}: ${error.message}`);
}

// "Gỡ" (an active fact) or "Bỏ" (a pending one): the AI stops using it at once,
// and every question it answered goes back to "Chưa ai trả lời".
export async function removeFact(db: Db, { shopId, factId, userId }: Who & { factId: string }): Promise<boolean> {
  const rows = await must(
    "learned_facts",
    db.from("learned_facts").update({ status: "removed", ...decided(userId) }).eq("id", factId).eq("shop_id", shopId).in("status", ["active", "pending"]).select("id"),
  );
  if (rows.length === 0) return false;
  await exec("data_gaps", db.from("data_gaps").update({ status: "open", learned_fact_id: null }).eq("learned_fact_id", factId).eq("shop_id", shopId));
  return true;
}

export async function approveFact(db: Db, { shopId, factId, userId }: Who & { factId: string }): Promise<boolean> {
  const rows = await must(
    "learned_facts",
    db.from("learned_facts").update({ status: "active", ...decided(userId) }).eq("id", factId).eq("shop_id", shopId).eq("status", "pending").select("id"),
  );
  return rows.length > 0;
}

export async function editFact(db: Db, { shopId, factId, userId, text }: Who & { factId: string; text: string }): Promise<boolean> {
  const rows = await must(
    "learned_facts",
    db.from("learned_facts").update({ text, ...decided(userId) }).eq("id", factId).eq("shop_id", shopId).in("status", ["active", "pending"]).select("id"),
  );
  return rows.length > 0;
}

export async function setLearningMode(db: Db, shopId: string, mode: "auto" | "review"): Promise<boolean> {
  const rows = await must("shops", db.from("shops").update({ learning_mode: mode }).eq("id", shopId).select("id"));
  return rows.length > 0;
}

// "Bỏ qua" on a topic, or "Đã xem" on items the shop doesn't sell.
export async function dismissGaps(db: Db, shopId: string, gapIds: string[]): Promise<number> {
  const rows = await must("data_gaps", db.from("data_gaps").update({ status: "dismissed" }).in("id", gapIds).eq("shop_id", shopId).eq("status", "open").select("id"));
  return rows.length;
}

// "Duyệt" on a drafted topic: the owner's own words, used at once. `admin` is the
// secret-key client (inserts are server only); the caller has checked the owner.
// Re-checks the draft has no blank left and the questions are this shop's open ones.
export async function insertFromDraft(
  admin: Db,
  { shopId, userId, gapIds, policyKind, text }: Who & { gapIds: string[]; policyKind: PolicyKind; text: string },
): Promise<"ok" | "blank" | "no_questions"> {
  if (hasBlank(text) || !text.trim()) return "blank";
  const { data: open, error } = await admin.from("data_gaps").select("id").in("id", gapIds).eq("shop_id", shopId).eq("status", "open");
  if (error) throw new Error(`data_gaps: ${error.message}`);
  if (open.length === 0) return "no_questions";
  const { data: fact, error: factError } = await admin
    .from("learned_facts")
    .insert({ shop_id: shopId, policy_kind: policyKind, text: text.trim(), status: "active", ...decided(userId) })
    .select("id")
    .single();
  if (factError) throw new Error(`learned_facts: ${factError.message}`);
  await exec(
    "data_gaps",
    admin.from("data_gaps").update({ status: "learned", learned_fact_id: fact.id }).in("id", open.map((g) => g.id)).eq("shop_id", shopId),
  );
  return "ok";
}
