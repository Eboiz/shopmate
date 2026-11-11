import { describe, expect, it } from "vitest";
import { displayColor, firstSentence, foldVietnamese, matchesQuery, productGroup, sizeRange } from "./catalog-view";

describe("catalog view helpers", () => {
  it("folds Vietnamese text for accent-free search", () => {
    expect(foldVietnamese("  Đầm   ĐỎ đô ")).toBe("dam do do");
  });

  it("maps PO slugs and older category words to five groups", () => {
    expect(productGroup("vay")).toBe("Váy & đầm");
    expect(productGroup("Đầm")).toBe("Váy & đầm");
    expect(productGroup("chan_vay")).toBe("Chân váy");
    expect(productGroup("Chân váy")).toBe("Chân váy");
    expect(productGroup("ao_khoac")).toBe("Áo khoác");
    expect(productGroup("Áo thun")).toBe("Áo");
    expect(productGroup("Quần jean")).toBe("Quần");
    expect(productGroup(null, "Áo sơ mi trắng")).toBe("Áo");
    expect(productGroup("Phụ kiện")).toBe("Khác");
  });

  it("matches every query word, without accents, in any order", () => {
    const fields = ["Đầm hoa nhí cổ vuông", "Váy & đầm", "đỏ đô", "be"];
    expect(matchesQuery(fields, "dam")).toBe(true);
    expect(matchesQuery(fields, "đầm đỏ")).toBe(true);
    expect(matchesQuery(fields, "do dam")).toBe(true);
    expect(matchesQuery(fields, "dam xanh")).toBe(false);
    expect(matchesQuery(fields, "   ")).toBe(true);
  });

  it("labels colors, size ranges and policy summaries", () => {
    expect(displayColor("xanh rêu")).toBe("Xanh rêu");
    expect(displayColor("Be")).toBe("Be");
    expect(sizeRange(["S", "M", "L"])).toBe("S–L");
    expect(sizeRange(["M"])).toBe("M");
    expect(sizeRange([])).toBe("");
    expect(firstSentence("Phí ship 30.000đ. Thanh toán COD.")).toBe("Phí ship 30.000đ.");
    expect(firstSentence("Không có dấu chấm")).toBe("Không có dấu chấm");
  });
});
