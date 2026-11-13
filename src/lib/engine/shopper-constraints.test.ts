import { describe, expect, it } from "vitest";
import { dropOtherSizeReplies, fitConstraints, hasConstraints, shopperConstraints, type ConstrainedItem } from "./shopper-constraints";

const BOT_04 = "Tôi có 300 nghìn, muốn đồ đi làm màu trắng, không thích váy. Gợi ý 2 món phù hợp có giá dưới ngân sách";

describe("shopperConstraints (PB-40)", () => {
  it("BOT-04: budget, excluded garment and count", () => {
    expect(shopperConstraints(BOT_04)).toEqual({ maxPrice: 300000, excludeGroups: ["Váy & đầm", "Chân váy"], count: 2 });
  });

  it("reads the usual ways of writing a budget", () => {
    expect(shopperConstraints("dưới 300k").maxPrice).toBe(300000);
    expect(shopperConstraints("tầm 250 ngàn thôi").maxPrice).toBe(250000);
    expect(shopperConstraints("ngân sách 300.000đ").maxPrice).toBe(300000);
    expect(shopperConstraints("không quá 1,5 triệu").maxPrice).toBe(1500000);
    expect(shopperConstraints("tối đa 1tr").maxPrice).toBe(1000000);
  });

  it("does not read measurements, a minimum or a bare number as a budget", () => {
    expect(shopperConstraints("mình cao 160cm nặng 50kg").maxPrice).toBeNull();
    expect(shopperConstraints("áo trên 300k có không").maxPrice).toBeNull();
    expect(shopperConstraints("size 28 còn không").maxPrice).toBeNull();
  });

  it("excludes the garment the shopper turns down, and only that one", () => {
    expect(shopperConstraints("không thích đầm").excludeGroups).toEqual(["Váy & đầm"]);
    expect(shopperConstraints("ko lấy chân váy nha").excludeGroups).toEqual(["Chân váy"]);
    expect(shopperConstraints("trừ áo khoác ra").excludeGroups).toEqual(["Áo khoác"]);
    expect(shopperConstraints("không muốn mặc quần").excludeGroups).toEqual(["Quần"]);
    expect(shopperConstraints("váy này còn không").excludeGroups).toEqual([]);
    expect(shopperConstraints("không thích màu đen").excludeGroups).toEqual([]);
  });

  it("reads how many items to suggest", () => {
    expect(shopperConstraints("gợi ý 3 mẫu").count).toBe(3);
    expect(shopperConstraints("chọn giúp hai món").count).toBe(2);
    expect(shopperConstraints("cho mình xem áo").count).toBeNull();
  });

  it("an ordinary question has no constraint", () => {
    expect(hasConstraints(shopperConstraints("màu trắng size M còn không?"))).toBe(false);
    expect(hasConstraints(shopperConstraints(BOT_04))).toBe(true);
  });
});

describe("fitConstraints (PB-40)", () => {
  const items: ConstrainedItem[] = [
    { name: "Chân váy bút chì", category: "chan_vay", price: 300000 },
    { name: "Chân váy chữ A", category: "chan_vay", price: 260000 },
    { name: "Đầm sơ mi thắt eo", category: "vay", price: 450000 },
    { name: "Áo sơ mi trắng", category: "ao", price: 250000 },
    { name: "Quần tây ống đứng", category: "quan", price: 290000 },
    { name: "Áo blazer", category: "ao", price: 450000 },
    { name: "Áo thun basic", category: "ao", price: 150000 },
  ];

  it("BOT-04: at most 2 items, no skirt or dress, none above 300.000đ", () => {
    const kept = fitConstraints(items, shopperConstraints(BOT_04));
    expect(kept.map((p) => p.name)).toEqual(["Áo sơ mi trắng", "Quần tây ống đứng"]);
  });

  it("nothing fits: empty, never the closest misses", () => {
    expect(fitConstraints(items.slice(0, 3), shopperConstraints(BOT_04))).toEqual([]);
  });

  it("no constraint: unchanged", () => {
    expect(fitConstraints(items, shopperConstraints("shop có gì"))).toEqual(items);
  });

  it("an item without a known price is kept only when no budget was given", () => {
    const unknown = [{ name: "Áo len", category: "ao" }];
    expect(fitConstraints(unknown, shopperConstraints("không thích váy"))).toEqual(unknown);
    expect(fitConstraints(unknown, shopperConstraints("dưới 300k"))).toEqual([]);
  });
});

describe("dropOtherSizeReplies (PB-40, BOT-02)", () => {
  const sizes = new Set(["s", "m", "l", "xl"]);

  it("drops buttons that push another size than the shopper's", () => {
    expect(dropOtherSizeReplies(["S trắng", "L trắng", "XL trắng", "Size M xanh nhạt", "Gặp nhân viên"], "M", sizes)).toEqual([
      "Size M xanh nhạt",
      "Gặp nhân viên",
    ]);
  });

  it("no known size: unchanged", () => {
    expect(dropOtherSizeReplies(["S trắng", "L trắng"], null, sizes)).toEqual(["S trắng", "L trắng"]);
  });
});
