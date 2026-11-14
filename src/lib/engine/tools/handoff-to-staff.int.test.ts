import { beforeEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore } from "../store";
import { FX, seedTwoShops } from "../test/two-shops";
import { handoffToStaff, setAiMode } from "./handoff-to-staff";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };

async function modeOf(id: string) {
  const { data } = await db.from("conversations").select("mode").eq("id", id).single();
  return data?.mode;
}

describe("handoff_to_staff", () => {
  beforeEach(() => seedTwoShops(db));

  it("hands an AI conversation to staff", async () => {
    expect(await handoffToStaff({ reason: "complaint" }, ctxA, db)).toEqual({ mode: "needs_human" });
    expect(await modeOf(FX.a.conversation)).toBe("needs_human");
  });

  it("leaves a conversation staff already took over alone", async () => {
    await db.from("conversations").update({ mode: "staff" }).eq("id", FX.a.conversation);
    await handoffToStaff({ reason: "complaint" }, ctxA, db);
    expect(await modeOf(FX.a.conversation)).toBe("staff");
  });

  it("never touches another shop's conversation", async () => {
    expect(await modeOf(FX.b.conversation)).toBe("ai");
    await handoffToStaff({ reason: "complaint" }, { shopId: FX.a.shop, conversationId: FX.b.conversation }, db);
    expect(await modeOf(FX.b.conversation)).toBe("ai");
  });

  it("needs a conversation", async () => {
    await expect(
      handoffToStaff({ reason: "complaint" }, { shopId: FX.a.shop, conversationId: null }, db),
    ).rejects.toMatchObject({ code: "no_conversation" });
  });

  describe("setAiMode (#8)", () => {
    it("resumes only when last_message_at still matches the turn's snapshot", async () => {
      await db.from("conversations").update({ mode: "needs_human" }).eq("id", FX.a.conversation);
      const { data } = await db.from("conversations").select("last_message_at").eq("id", FX.a.conversation).single();
      const current = data!.last_message_at;
      const stale = new Date(Date.parse(current) - 60_000).toISOString();
      // A newer shopper message bumps last_message_at (receive.ts), so the
      // snapshot from an older turn matches no row and the resume must no-op.
      await setAiMode(db, ctxA, stale);
      expect(await modeOf(FX.a.conversation)).toBe("needs_human");
      await setAiMode(db, ctxA, current);
      expect(await modeOf(FX.a.conversation)).toBe("ai");
    });

    it("resumeAiIfLatest resumes only while the answered message is the shopper's newest", async () => {
      const store = createSupabaseStore(db);
      await db.from("conversations").update({ mode: "needs_human" }).eq("id", FX.a.conversation);
      const insert = async (text: string, at: string) => {
        const { data, error } = await db.from("messages").insert({
          shop_id: FX.a.shop, conversation_id: FX.a.conversation, sender: "shopper", text, created_at: at,
        }).select("id").single();
        if (error) throw error;
        return data.id;
      };
      const older = await insert("váy còn không?", "2099-01-01T00:00:00Z");
      const newer = await insert("hàng bị rách, mình muốn khiếu nại", "2099-01-01T00:00:05Z");
      // The older turn answers late: a newer shopper message exists, so no resume.
      expect(await store.resumeAiIfLatest!(ctxA, older)).toBe(false);
      expect(await modeOf(FX.a.conversation)).toBe("needs_human");
      // Another shop's conversation id with this shop is never touched.
      expect(await store.resumeAiIfLatest!({ shopId: FX.b.shop, conversationId: FX.a.conversation }, newer)).toBe(false);
      expect(await store.resumeAiIfLatest!(ctxA, newer)).toBe(true);
      expect(await modeOf(FX.a.conversation)).toBe("ai");
    });

    it("without a snapshot it resumes as before", async () => {
      await db.from("conversations").update({ mode: "needs_human" }).eq("id", FX.a.conversation);
      await setAiMode(db, ctxA);
      expect(await modeOf(FX.a.conversation)).toBe("ai");
    });
  });
});
