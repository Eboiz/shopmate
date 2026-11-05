import { describe, expect, it } from "vitest";
import { parseCsv, readDemoData, type SheetName } from "./sheet.ts";

// A small valid shop: 2 products, 3 sizes x 2 colors each, one pairing.
function sheets(): Record<SheetName, string> {
  const variants = ["SP01", "SP02"].flatMap((code) =>
    ["S", "M", "L"].flatMap((size) => ["Đen", "Trắng"].map((color) => `${code},${size},${color},5`)),
  );
  const charts = ["SP01", "SP02"].flatMap((code) => [
    `${code},S,150,157,40,47`,
    `${code},M,158,165,48,55`,
    `${code},L,166,175,56,65`,
  ]);
  return {
    shop: "ten_shop,slug\nShop Mây,shop-may",
    products: [
      "ma_sp,ten,loai,gia,mo_ta,anh",
      'SP01,Váy suông linen,Váy,350000,"Vải linen, mát",',
      "SP02,Áo thun cổ tròn,Áo,150000,,",
    ].join("\n"),
    variants: ["ma_sp,size,mau,ton_kho", ...variants].join("\n"),
    size_charts: ["ma_sp,size,cao_tu_cm,cao_den_cm,nang_tu_kg,nang_den_kg", ...charts].join("\n"),
    pairings: "ma_sp_1,ma_sp_2,ly_do\nSP01,SP02,Cùng tông màu",
    policies: "loai,noi_dung\ndoi_tra,Đổi trong 7 ngày\ngiao_hang,Giao 2-3 ngày\nkhuyen_mai,",
  };
}

function withSheet(name: SheetName, edit: (csv: string) => string) {
  const s = sheets();
  s[name] = edit(s[name]);
  return readDemoData(s);
}

describe("parseCsv", () => {
  it("handles a BOM, CRLF, quotes, escaped quotes and newlines inside a cell", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\nc,d\r\n')).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["x, y", 'say "hi"\nthere'] },
      { line: 4, cells: ["c", "d"] },
    ]);
  });

  it("skips empty lines and rows of empty cells, keeping each record's line in the file", () => {
    expect(parseCsv("a\n\n,,\nb\n")).toEqual([
      { line: 1, cells: ["a"] },
      { line: 4, cells: ["b"] },
    ]);
  });
});

describe("unclosed quote", () => {
  it("is an error naming the line it starts on, not a silently swallowed file", () => {
    expect(() => parseCsv('a,b\n"x,y\nc,d\n')).toThrow("ngoặc kép mở ở dòng 2 không được đóng");
    const { data, errors } = withSheet("products", (c) => c.replace("Váy suông linen", '"Váy suông linen'));
    expect(data).toBeNull();
    expect(errors).toEqual(["products: ngoặc kép mở ở dòng 2 không được đóng"]);
  });
});

describe("error locations", () => {
  it("names the line of the file, after an empty row or a cell spanning lines", () => {
    const { errors } = withSheet("products", (c) =>
      c.replace("\nSP02,Áo thun cổ tròn,Áo,150000,,", '\n,,,,,\nSP02,Áo thun cổ tròn,Áo,150k,"hai\ndòng",'),
    );
    expect(errors).toContain("products dòng 4, cột gia: phải là số nguyên đồng");
  });
});

describe("one spelling per size and color", () => {
  it("rejects a size or color written two ways for the same product", () => {
    const { errors } = withSheet("variants", (c) =>
      c.replace("SP01,M,Trắng,5", "SP01,m,Trắng,5").replace("SP02,S,Trắng,5", "SP02,S,trắng,5"),
    );
    expect(errors).toContain("variants dòng 5: SP01 size m viết khác dòng 4 (M)");
    expect(errors).toContain("variants dòng 11: SP02 màu Trắng viết khác dòng 9 (trắng)");
  });
});

describe("readDemoData", () => {
  it("reads a valid shop", () => {
    const { data, errors } = readDemoData(sheets());
    expect(errors).toEqual([]);
    expect(data?.shop).toEqual({ name: "Shop Mây", slug: "shop-may" });
    expect(data?.products[0]).toEqual({
      code: "SP01",
      name: "Váy suông linen",
      category: "Váy",
      price: 350000,
      description: "Vải linen, mát",
    });
    expect(data?.products[1]).toMatchObject({ description: null });
    expect(data?.variants).toHaveLength(12);
    expect(data?.sizeCharts[1]).toEqual({
      code: "SP01", size: "M", heightMin: 158, heightMax: 165, weightMin: 48, weightMax: 55,
    });
    expect(data?.pairings).toEqual([{ a: "SP01", b: "SP02", reason: "Cùng tông màu" }]);
    expect(data?.policies).toContainEqual({ kind: "khuyen_mai", content: "" });
  });

  it("normalizes text to NFC and trims it", () => {
    const decomposed = "Váy"; // "Váy" with a combining accent
    const { data } = withSheet("products", (c) => c.replace("Váy suông", ` ${decomposed} suông`));
    expect(data?.products[0].name).toBe("Váy suông linen");
  });

  it("warns, without failing, when the counts differ from the issue (30 products, 10 pairings)", () => {
    const { errors, warnings } = readDemoData(sheets());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "products: 2 sản phẩm, issue yêu cầu 30",
      "pairings: 1 cặp, issue yêu cầu 10",
    ]);
  });

  it("rejects a missing column, naming the sheet", () => {
    const { data, errors } = withSheet("products", (c) => c.replace(",gia,", ",price,"));
    expect(data).toBeNull();
    expect(errors).toContain("products: thiếu cột gia");
  });

  it.each([
    ["350k", "phải là số nguyên đồng"],
    ["350.000", "phải là số nguyên đồng"],
    ["350000.5", "phải là số nguyên đồng"],
    ["-1", "phải là số nguyên đồng"],
    ["0", "phải lớn hơn 0"],
    ["100000000", "phải nhỏ hơn 100000000"],
  ])("rejects gia = %s", (gia, message) => {
    const { errors } = withSheet("products", (c) => c.replace("350000", gia));
    expect(errors).toContain(`products dòng 2, cột gia: ${message}`);
  });

  it("rejects an empty required cell", () => {
    const { errors } = withSheet("products", (c) => c.replace("Áo thun cổ tròn", ""));
    expect(errors).toContain("products dòng 3, cột ten: không được để trống");
  });

  it("rejects a product code used twice, ignoring case", () => {
    const { errors } = withSheet("products", (c) => c.replace("SP02,Áo", "sp01,Áo"));
    expect(errors).toContain("products dòng 3: ma_sp sp01 trùng dòng 2");
  });

  it("rejects a slug that is not lowercase-with-dashes", () => {
    const { errors } = withSheet("shop", (c) => c.replace("shop-may", "Shop Mây"));
    expect(errors).toContain("shop dòng 2, cột slug: chỉ gồm chữ thường không dấu, số và dấu gạch ngang");
  });

  it("needs exactly one shop row", () => {
    const { errors } = withSheet("shop", (c) => `${c}\nShop Hai,shop-hai`);
    expect(errors).toContain("shop: cần đúng 1 dòng, có 2");
  });

  it.each([
    ["-1", "phải là số nguyên từ 0 trở lên"],
    ["2.5", "phải là số nguyên từ 0 trở lên"],
    ["2147483648", "quá lớn"],
  ])("rejects ton_kho = %s", (stock, message) => {
    const { errors } = withSheet("variants", (c) => c.replace("SP01,S,Đen,5", `SP01,S,Đen,${stock}`));
    expect(errors).toContain(`variants dòng 2, cột ton_kho: ${message}`);
  });

  it("rejects a variant of an unknown product", () => {
    const { errors } = withSheet("variants", (c) => `${c}\nSP99,S,Đen,1`);
    expect(errors).toContain("variants dòng 14: ma_sp SP99 không có trong products");
  });

  it("rejects the same product, size and color twice", () => {
    const { errors } = withSheet("variants", (c) => `${c}\nSP01,S,Đen,1`);
    expect(errors).toContain("variants dòng 14: SP01 size S màu Đen trùng dòng 2");
  });

  it("rejects a product whose sizes and colors don't form a full grid", () => {
    const { errors } = withSheet("variants", (c) => c.replace("\nSP01,L,Trắng,5", ""));
    expect(errors).toContain("variants: SP01 thiếu dòng size L màu Trắng");
  });

  it("rejects fewer than 3 sizes or 2 colors, and more than 5 sizes or 3 colors", () => {
    const fewSizes = withSheet("variants", (c) =>
      c.split("\n").filter((l) => !l.startsWith("SP01,L,")).join("\n"),
    );
    expect(fewSizes.errors).toContain("variants: SP01 có 2 size, cần 3 đến 5");

    const manyColors = withSheet("variants", (c) =>
      ["Xanh", "Đỏ"].reduce(
        (csv, color) => `${csv}\n${["S", "M", "L"].map((s) => `SP02,${s},${color},1`).join("\n")}`,
        c,
      ),
    );
    expect(manyColors.errors).toContain("variants: SP02 có 4 màu, cần 2 đến 3");
  });

  it("rejects a size chart whose sizes differ from the product's variants", () => {
    const { errors } = withSheet("size_charts", (c) => c.replace("SP02,L,166", "SP02,XL,166"));
    expect(errors).toContain("size_charts: SP02 có size XL không bán (variants: S, M, L)");
    expect(errors).toContain("size_charts: SP02 thiếu size L");
  });

  it("rejects a size chart row with min above max or a non-positive min", () => {
    const { errors } = withSheet("size_charts", (c) =>
      c.replace("SP01,S,150,157,40,47", "SP01,S,160,157,0,47"),
    );
    expect(errors).toContain("size_charts dòng 2: cao_tu_cm 160 lớn hơn cao_den_cm 157");
    expect(errors).toContain("size_charts dòng 2, cột nang_tu_kg: phải lớn hơn 0");
  });

  it("rejects overlapping height or weight ranges within a product, edges included", () => {
    const { errors } = withSheet("size_charts", (c) =>
      c.replace("SP01,M,158,165,48,55", "SP01,M,157,165,48,55"),
    );
    expect(errors).toContain("size_charts: SP01 size S và M chồng khoảng chiều cao (150–157 và 157–165 cm)");
  });

  it("rejects the same product and size twice in the size chart", () => {
    const { errors } = withSheet("size_charts", (c) => `${c}\nSP01,m,158,165,48,55`);
    expect(errors).toContain("size_charts dòng 8: SP01 size m trùng dòng 3");
  });

  it("rejects a pairing of a product with itself, an empty reason, and a repeated pair in either order", () => {
    const { errors } = withSheet("pairings", (c) => `${c}\nSP01,SP01,Tự ghép\nSP02,SP01,Lặp lại\nSP01,SP02,`);
    expect(errors).toContain("pairings dòng 3: một sản phẩm không ghép với chính nó");
    expect(errors).toContain("pairings dòng 4: cặp SP02–SP01 trùng dòng 2");
    expect(errors).toContain("pairings dòng 5, cột ly_do: không được để trống");
  });

  it("rejects an unknown or repeated policy kind, and a missing one", () => {
    const { errors } = withSheet("policies", (c) =>
      c.replace("giao_hang,", "giaohang,").replace("khuyen_mai,", "doi_tra,Lặp"),
    );
    expect(errors).toContain("policies dòng 3, cột loai: phải là doi_tra, giao_hang hoặc khuyen_mai");
    expect(errors).toContain("policies dòng 4: loai doi_tra trùng dòng 2");
    expect(errors).toContain("policies: thiếu dòng giao_hang");
    expect(errors).toContain("policies: thiếu dòng khuyen_mai");
  });
});
