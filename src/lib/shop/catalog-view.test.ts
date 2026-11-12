import { describe, expect, it } from "vitest";
import { displayColor, firstSentence, foldVietnamese, matchesQuery, productGroup, readShopFilters, shopFilterQuery, sizeRange } from "./catalog-view";

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

describe("shop filters in the URL", () => {
  const available = { groups: ["Áo", "Váy & đầm", "Quần"] as const, sizes: ["S", "M", "L"] };
  const read = (query: string) => readShopFilters(new URLSearchParams(query), available);

  it("reads group, search, size and sort from the query", () => {
    expect(read("nhom=vay&tim=linen&size=M&sap-xep=gia-tang")).toEqual({ group: "Váy & đầm", search: "linen", size: "M", sort: "price-asc" });
    expect(read("sap-xep=gia-giam").sort).toBe("price-desc");
  });

  it("falls back to the defaults for an empty query", () => {
    expect(read("")).toEqual({ group: "", search: "", size: "", sort: "group" });
  });

  it("ignores unknown values and groups or sizes the shop doesn't have", () => {
    expect(read("nhom=abc&sap-xep=x&size=XXL")).toEqual({ group: "", search: "", size: "", sort: "group" });
    expect(read("nhom=khac").group).toBe("");
    expect(read("sap-xep=constructor&nhom=toString").sort).toBe("group");
    expect(read("sap-xep=__proto__").sort).toBe("group");
  });

  it("writes only the filters that differ from the defaults, keeping other parameters", () => {
    const current = new URLSearchParams("utm_source=zalo&nhom=ao");
    expect(shopFilterQuery({ group: "Váy & đầm", search: "váy đỏ", size: "M", sort: "price-desc" }, current))
      .toBe("?utm_source=zalo&nhom=vay&tim=v%C3%A1y+%C4%91%E1%BB%8F&size=M&sap-xep=gia-giam");
    expect(shopFilterQuery({ group: "", search: "  ", size: "", sort: "group" }, current)).toBe("?utm_source=zalo");
    expect(shopFilterQuery({ group: "", search: "", size: "", sort: "group" }, new URLSearchParams())).toBe("");
  });

  it("round-trips every group through its slug", () => {
    const groups = ["Áo", "Áo khoác", "Váy & đầm", "Chân váy", "Quần", "Khác"] as const;
    for (const group of groups) {
      const query = shopFilterQuery({ group, search: "", size: "", sort: "group" }, new URLSearchParams());
      expect(readShopFilters(new URLSearchParams(query), { groups, sizes: [] }).group).toBe(group);
    }
  });
});
