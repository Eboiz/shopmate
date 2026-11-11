import { describe, expect, it } from "vitest";
import { canonical, isCatalogQuestion, isReturnsQuestion, productsForOccasion, productsNamedIn, rankProducts } from "./product-match";

const P = (name: string, category: string | null = null) => ({ name, category });
const catalog = [
  P("Váy suông linen", "vay"),
  P("Đầm hoa nhí cổ vuông", "vay"),
  P("Váy maxi đi biển", "vay"),
  P("Áo sơ mi basic", "ao"),
  P("Quần jean ống rộng", "quan"),
  P("Áo khoác bomber", "Áo khoác"),
  P("Áo khoác jean", "Áo khoác"),
  P("Áo len mỏng tay dài", "ao"),
];
const names = (r: { products: { name: string }[] }) => r.products.map((p) => p.name);

describe("canonical", () => {
  it("folds, drops punctuation and applies synonyms", () => {
    expect(canonical("Quần Bò!")).toBe("quan jean");
    expect(canonical("Đầm")).toBe("vay");
    expect(canonical("sơ mi")).toBe("somi");
    expect(canonical("ao_khoac")).toBe("ao khoac");
  });
  it("keeps the color xanh đậm apart from đầm", () => {
    expect(canonical("xanh đậm")).toBe("xanhdam");
  });
});

describe("rankProducts", () => {
  it("exact: every word in name or category, any order, no diacritics", () => {
    expect(rankProducts("vay suong linen", catalog, 5)).toEqual({ match: "exact", products: [catalog[0]] });
    expect(names(rankProducts("linen váy", catalog, 5))).toEqual(["Váy suông linen"]);
  });
  it("exact through a synonym: đầm = váy, quần bò = quần jean, somi = sơ mi", () => {
    expect(names(rankProducts("dam di bien", catalog, 5))).toEqual(["Váy maxi đi biển"]);
    expect(names(rankProducts("quan bo", catalog, 5))).toEqual(["Quần jean ống rộng"]);
    expect(names(rankProducts("ao somi", catalog, 5))).toEqual(["Áo sơ mi basic"]);
  });
  it("close: no exact match, products sharing at least half the words, best first", () => {
    const r = rankProducts("ao khoac da", catalog, 5);
    expect(r.match).toBe("close");
    expect(names(r)).toEqual(["Áo khoác bomber", "Áo khoác jean"]);
  });
  it("none when nothing shares enough words", () => {
    expect(rankProducts("giay cao got", catalog, 5)).toEqual({ match: "none", products: [] });
    expect(rankProducts("   ", catalog, 5)).toEqual({ match: "none", products: [] });
  });
  it("respects the limit", () => {
    expect(rankProducts("vay", catalog, 2).products).toHaveLength(2);
  });
  it("a word of 3+ letters matches the start of a name word", () => {
    expect(names(rankProducts("ao khoac bomb", catalog, 5))).toEqual(["Áo khoác bomber"]);
  });
});

describe("productsForOccasion", () => {
  const withDesc = [
    { name: "Đầm xòe công sở", category: "vay", description: "Dáng xòe, hợp đi làm công sở." },
    { name: "Váy hai dây lụa", category: "vay", description: "Lụa mềm, hợp đi tiệc tối." },
    { name: "Áo thun", category: "ao", description: null },
  ];
  it("matches occasion words against descriptions", () => {
    expect(productsForOccasion("có đồ đi tiệc không shop", withDesc, 3).map((p) => p.name)).toEqual(["Váy hai dây lụa"]);
    expect(productsForOccasion("đồ công sở", withDesc, 3).map((p) => p.name)).toEqual(["Đầm xòe công sở"]);
  });
  it("garment and filler words alone suggest nothing", () => {
    expect(productsForOccasion("shop có váy gì", withDesc, 3)).toEqual([]);
  });
});

describe("productsNamedIn", () => {
  it("finds products whose name words the shopper used, two words at least", () => {
    expect(productsNamedIn("loại áo khoác da màu đen ấy", catalog, 3).map((p) => p.name)).toEqual([
      "Áo khoác bomber",
      "Áo khoác jean",
    ]);
  });
  it("one shared word is not enough", () => {
    expect(productsNamedIn("shop có áo gì", catalog, 3)).toEqual([]);
  });
  it("needs half of the product's own words: áo … dài is not Áo len mỏng tay dài", () => {
    expect(productsNamedIn("cái áo măng tô dài tới gối ấy", catalog, 3)).toEqual([]);
  });
  it("ignores questions and fillers", () => {
    expect(productsNamedIn("shop còn hàng không", catalog, 3)).toEqual([]);
  });
});

describe("PB-31 question kinds", () => {
  it("isCatalogQuestion: what does the shop sell, not a question about one product", () => {
    for (const t of ["hiện tại bên mình có những sản phẩm gì", "shop có gì", "Shop bán những gì vậy?", "có những mặt hàng nào", "shop co nhung mon gi"]) {
      expect(isCatalogQuestion(t), t).toBe(true);
    }
    for (const t of ["áo này có màu gì", "váy có size gì", "đồ đi tiệc", "còn hàng size M không", "áo này có hàng size gì"]) {
      expect(isCatalogQuestion(t), t).toBe(false);
    }
  });

  it("isReturnsQuestion: exchanges and returns, with or without diacritics", () => {
    for (const t of ["Mua về mặc không vừa thì đổi được không shop?", "đổi size được không", "chính sách đổi trả thế nào", "tra hang duoc khong"]) {
      expect(isReturnsQuestion(t), t).toBe(true);
    }
    for (const t of ["váy này có đôi bông tai đi kèm không", "doi lau khong shop", "áo co giãn không"]) {
      expect(isReturnsQuestion(t), t).toBe(false);
    }
  });
});
