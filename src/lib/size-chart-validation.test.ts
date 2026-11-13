import { describe, expect, it } from "vitest";
import { recommendSize } from "@/lib/engine/tools/size-recommendation";
import { checkSizeChart, saveSizeChartSchema, type SizeChartDraftRow } from "./size-chart-validation";

const row = (size: string, h: string, w: string): SizeChartDraftRow => {
  const [heightMin, heightMax] = h.split("-");
  const [weightMin, weightMax] = w.split("-");
  return { size, heightMin, heightMax, weightMin, weightMax };
};

const errorOf = (rows: SizeChartDraftRow[]) => {
  const result = checkSizeChart(rows);
  return result.ok ? null : result.error;
};

describe("checkSizeChart", () => {
  it("accepts neighbouring sizes and returns numbers", () => {
    const result = checkSizeChart([row(" S ", "150-155", "40-45"), row("M", "156-162", "46-52")]);
    expect(result).toEqual({
      ok: true,
      rows: [
        { size: "S", heightMin: 150, heightMax: 155, weightMin: 40, weightMax: 45 },
        { size: "M", heightMin: 156, heightMax: 162, weightMin: 46, weightMax: 52 },
      ],
    });
  });

  it("accepts an empty chart (the AI then hands size questions to staff)", () => {
    expect(checkSizeChart([])).toEqual({ ok: true, rows: [] });
  });

  it("refuses overlapping heights and names both sizes", () => {
    expect(errorOf([row("S", "150-156", "40-45"), row("M", "155-162", "46-52")])).toBe(
      "Size S và M chồng khoảng chiều cao (150–156 và 155–162 cm). Mỗi chiều cao chỉ được thuộc một size.",
    );
  });

  it("treats a shared bound as an overlap (ranges are inclusive)", () => {
    expect(errorOf([row("S", "150-155", "40-45"), row("M", "156-162", "45-52")])).toContain("chồng khoảng cân nặng");
  });

  it("finds an overlap between rows that are not next to each other", () => {
    expect(errorOf([row("S", "150-155", "40-45"), row("L", "163-170", "53-60"), row("M", "156-165", "46-52")])).toContain(
      "Size L và M chồng khoảng chiều cao",
    );
  });

  it("refuses the same size twice, whatever the case", () => {
    expect(errorOf([row("M", "150-155", "40-45"), row("m", "156-162", "46-52")])).toBe("Size m bị lặp. Mỗi size chỉ một dòng.");
  });

  it.each([
    [[row("", "150-155", "40-45")], "Dòng 1: hãy nhập tên size, ví dụ M."],
    [[row("XXXXXXXXXXL", "150-155", "40-45")], "Dòng 1: tên size tối đa 10 ký tự."],
    [[row("S", "abc-155", "40-45")], "Size S: chiều cao phải là số nguyên (cm), ví dụ 155 đến 160."],
    [[row("S", "150-", "40-45")], "Size S: chiều cao phải là số nguyên (cm), ví dụ 155 đến 160."],
    [[row("S", "150-155", "40.5-45")], "Size S: cân nặng phải là số nguyên (kg), ví dụ 45 đến 50."],
    [[row("S", "160-150", "40-45")], 'Size S: chiều cao "từ" (160) lớn hơn "đến" (150).'],
    [[row("S", "0-150", "40-45")], "Size S: chiều cao phải từ 1 đến 250 cm."],
    [[row("S", "150-1600", "40-45")], "Size S: chiều cao phải từ 1 đến 250 cm."],
    [[row("S", "150-260", "40-45")], "Size S: chiều cao phải từ 1 đến 250 cm."],
    [[row("S", "150-155", "40-450")], "Size S: cân nặng phải từ 1 đến 200 kg."],
  ])("explains a bad row %#", (rows, message) => {
    expect(errorOf(rows)).toBe(message);
  });

  it("caps the number of rows", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`S${i}`, `${100 + i * 5}-${104 + i * 5}`, `${30 + i * 5}-${34 + i * 5}`));
    expect(errorOf(rows)).toBe("Bảng size tối đa 10 dòng.");
  });

  it("gives recommend_size a chart where each measurement points to one size", () => {
    const result = checkSizeChart([row("S", "150-155", "40-45"), row("M", "156-162", "46-52"), row("L", "163-170", "53-60")]);
    if (!result.ok) throw new Error(result.error);
    const chart = result.rows.map((r) => ({
      size: r.size,
      height_min_cm: r.heightMin,
      height_max_cm: r.heightMax,
      weight_min_kg: r.weightMin,
      weight_max_kg: r.weightMax,
    }));
    expect(recommendSize(chart, 158, 47)).toMatchObject({ status: "ok", size: "M" });
    expect(recommendSize(chart, 156, 53)).toMatchObject({ status: "ok", size: "L", sizeByHeight: "M", sizeByWeight: "L" });
  });
});

describe("saveSizeChartSchema", () => {
  const parse = (rows: string) => saveSizeChartSchema.safeParse({ productId: "p1", rows });

  it("reads the rows the editor posts as JSON", () => {
    const result = parse(JSON.stringify([row("M", "156-162", "46-52")]));
    expect(result.data).toEqual({
      productId: "p1",
      rows: [{ size: "M", heightMin: 156, heightMax: 162, weightMin: 46, weightMax: 52 }],
    });
  });

  it("returns the chart problem as the message", () => {
    const result = parse(JSON.stringify([row("S", "150-156", "40-45"), row("M", "155-162", "46-52")]));
    expect(result.error?.issues[0].message).toContain("chồng khoảng chiều cao");
  });

  it.each(["not json", "{}", '[{"size": "M"}]', "[1]"])("refuses a body the editor never sends: %s", (rows) => {
    expect(parse(rows).error?.issues[0].message).toBe("Dữ liệu bảng size không đọc được, hãy tải lại trang.");
  });
});
