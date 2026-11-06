import { beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { getPolicy } from "./get-policy";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const ctxB = { shopId: FX.b.shop, conversationId: FX.b.conversation };

describe("get_policy", () => {
  beforeAll(() => seedTwoShops(db));

  it("returns the shop's text", async () => {
    expect(await getPolicy({ kind: "doi_tra" }, ctxA, db)).toEqual({ kind: "doi_tra", content: "Đổi trong 7 ngày" });
  });

  it("treats blank text as no policy", async () => {
    expect(await getPolicy({ kind: "giao_hang" }, ctxA, db)).toEqual({ kind: "giao_hang", content: null });
  });

  it("returns null when there is no row", async () => {
    expect(await getPolicy({ kind: "khuyen_mai" }, ctxA, db)).toEqual({ kind: "khuyen_mai", content: null });
  });

  it("reads each shop's own policy", async () => {
    expect(await getPolicy({ kind: "doi_tra" }, ctxB, db)).toEqual({ kind: "doi_tra", content: "Shop B không đổi trả" });
  });
});
