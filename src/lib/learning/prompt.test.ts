import { describe, expect, it } from "vitest";
import { gapsModelOutputSchema } from "./gaps";
import { buildGapsSystemPrompt, buildLearnSystemPrompt, buildLearnUserMessage, LEARNING_PROMPT_VERSION } from "./prompt";

describe("learning prompt", () => {
  it("is versioned v1.3", () => {
    expect(LEARNING_PROMPT_VERSION).toBe("v1.3");
    expect(buildLearnSystemPrompt()).toContain("v1.3");
  });

  it("spells out the gaps JSON shape (the gateway doesn't enforce the schema)", () => {
    const prompt = buildGapsSystemPrompt();
    const example = /dạng (\{.*\})\. policyKind/.exec(prompt)?.[1];
    expect(gapsModelOutputSchema.safeParse(JSON.parse(example ?? "null")).success).toBe(true);
    expect(prompt).not.toContain("theo schema");
  });

  it("marks a policy the shop has not written", () => {
    const msg = buildLearnUserMessage({
      target: "policy",
      question: "Kiểm hàng được không?",
      staffReply: "Dạ có ạ",
      policies: [
        { kind: "doi_tra", content: "Đổi trong 7 ngày" },
        { kind: "giao_hang", content: null },
      ],
    });
    expect(msg).toContain("doi_tra: Đổi trong 7 ngày");
    expect(msg).toContain("giao_hang: (chưa có)");
    expect(msg).toContain("khuyen_mai: (chưa có)");
    expect(msg).toContain("<cau_hoi_cua_khach>\nKiểm hàng được không?\n</cau_hoi_cua_khach>");
    expect(msg).toContain("<tin_nhan_vien>\nDạ có ạ\n</tin_nhan_vien>");
  });
});
