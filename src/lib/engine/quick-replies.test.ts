import { describe, expect, it } from "vitest";
import type { CatalogItem } from "./jev";
import { filterQuickReplies, GARMENT_WORDS, QUICK_REPLY_STOP_WORDS } from "./quick-replies";

const catalog: CatalogItem[] = [
  { id: "a0000000-0000-4000-8000-000000000011", name: "Áo khoác bomber", category: "Áo khoác", colors: ["Đen", "Be"], sizes: ["S", "M"] },
  { id: "a0000000-0000-4000-8000-000000000012", name: "Áo khoác jean", category: "Áo khoác", colors: [], sizes: [] },
  { id: "a0000000-0000-4000-8000-000000000013", name: "Áo blazer nữ", category: "Áo", colors: ["Đen"], sizes: [] },
];

describe("filterQuickReplies", () => {
  it("drops quick replies naming a garment the shop doesn't sell", () => {
    expect(filterQuickReplies(["Áo khoác da nam", "Áo khoác da nữ", "Tìm lại áo da"], catalog)).toEqual([]);
  });

  it("keeps quick replies that name what the shop sells or no garment at all", () => {
    const replies = [
      "Xem bomber",
      "Áo blazer đen",
      "Áo khoác jean",
      "Mặc với gì đẹp",
      "Đặt size S màu Trắng",
      "Hỏi nhân viên",
    ];
    expect(filterQuickReplies(replies, catalog)).toEqual(replies);
  });

  it("keeps the order the model wrote", () => {
    expect(filterQuickReplies(["Áo khoác da nam", "Xem bomber", "Áo da nữ", "Hỏi nhân viên"], catalog)).toEqual([
      "Xem bomber",
      "Hỏi nhân viên",
    ]);
  });

  it("with an empty catalog keeps only replies without garment words", () => {
    expect(filterQuickReplies(["Áo khoác da nam", "Mặc với gì đẹp", "Hỏi nhân viên"], [])).toEqual([
      "Mặc với gì đẹp",
      "Hỏi nhân viên",
    ]);
  });

  it("has the folded word lists", () => {
    expect(GARMENT_WORDS).toContain("khoac");
    expect(GARMENT_WORDS).toContain("chan vay");
    expect(QUICK_REPLY_STOP_WORDS).toContain("mau khac");
  });
});
