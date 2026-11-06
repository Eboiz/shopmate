import { beforeEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { handoffToStaff } from "./handoff-to-staff";

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
});
