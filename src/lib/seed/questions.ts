import { fold } from "../engine/text.ts";
import { resolvePairings } from "../engine/tools/get-pairings.ts";
import { recommendSize } from "../engine/tools/size-recommendation.ts";
import { parseCsv, type DemoData } from "./sheet.ts";

const COLUMNS = [
  "stt", "nhom", "dinh_danh_khach", "ma_sp_dang_xem", "cau_hoi", "size_dung",
  "con_hang", "mon_goi_y", "chuyen_staff", "gia_dung", "ghi_chu",
] as const;

// These phrases must keep referring to the original products when PO adds rows.
const PROTECTED_SEARCHES = [
  "vay suong linen", "dam hoa nhi co vuong", "chan vay xep ly",
  "ao so mi basic", "quan jean ong rong", "ao mang to",
];
const ORIGINAL_CODE = /^(VAY0[1-8]|CV0[1-5]|AO0[1-9]|QUAN0[1-5]|AK0[1-3])$/;

function searchedProduct(data: DemoData, question: string) {
  const words = ` ${fold(question)} `;
  const scored = data.products.map((product) => {
    const name = fold(product.name).split(/\s+/);
    let score = 0;
    for (let length = 3; length <= name.length; length++) {
      if (words.includes(` ${name.slice(0, length).join(" ")} `)) score = length;
    }
    return { product, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 && scored[0].score !== scored[1]?.score ? scored[0].product : undefined;
}

// Checks the PO's labels against catalog data. This does not call an AI model.
// Measurements are read from customer utterances, including earlier turns.
export function checkTestQuestions(data: DemoData, csv: string): string[] {
  const errors: string[] = [];
  let rows: ReturnType<typeof parseCsv>;
  try {
    rows = parseCsv(csv);
  } catch (error) {
    return [`test_questions: ${(error as Error).message}`];
  }
  const [header, ...body] = rows;
  const columns = new Map(header?.cells.map((name, index) => [name.trim(), index]));
  for (const name of COLUMNS) {
    if (!columns.has(name)) errors.push(`test_questions: thiếu cột ${name}`);
  }
  if (errors.length) return errors;
  if (body.length !== 60) errors.push(`test_questions: cần 60 câu, có ${body.length}`);
  const customers = new Map<string, { code?: string; height?: number; weight?: number; handedOff: boolean }>();
  const pairingRows = data.pairings.map((p) => ({ product_a_id: p.a, product_b_id: p.b, reason: p.reason }));
  const products = data.products.map((p) => ({ id: p.code, name: p.name, price: p.price, image_url: null }));
  const inStock = data.variants.filter((v) => v.stock > 0).map((v) => ({ product_id: v.code, size: v.size }));

  for (const [index, row] of body.entries()) {
    const get = (name: typeof COLUMNS[number]) => (row.cells[columns.get(name)!] ?? "").trim();
    const label = `test_questions câu ${get("stt")} (dòng ${row.line})`;
    const bad = (message: string) => errors.push(`${label}: ${message}`);
    if (get("stt") !== String(index + 1)) bad(`stt phải là ${index + 1}`);
    if (!get("dinh_danh_khach") || !get("cau_hoi") || !get("nhom")) bad("thiếu định danh khách, nhóm hoặc câu hỏi");
    const previous = customers.get(get("dinh_danh_khach")) ?? { handedOff: false };
    if (previous.handedOff) bad("có lượt tiếp theo sau khi đã chuyển staff");
    const question = fold(get("cau_hoi")).replace(/[?!,]/g, " ");
    const code = get("ma_sp_dang_xem") || searchedProduct(data, question)?.code || previous.code;
    const product = data.products.find((p) => p.code === code);
    if (code && !product) bad(`sản phẩm ${code} không tồn tại`);
    const meters = question.match(/\b(\d)m(\d{1,2})\b/);
    const centimeters = question.match(/\b(?:cao\s+)?(\d{3})(?:\s*cm)?\b/);
    const kilograms = question.match(/\b(\d{2})(?:\s*)(?:kg|ky|can)\b/);
    const height = meters ? Number(meters[1]) * 100 + Number(meters[2].padEnd(2, "0"))
      : centimeters ? Number(centimeters[1]) : previous.height;
    const weight = kilograms ? Number(kilograms[1]) : previous.weight;
    const size = question.match(/\bsize\s+(xs|s|m|l|xl|xxl)\b/)?.[1].toUpperCase();
    const handoff = get("chuyen_staff");
    if (!["co", "khong"].includes(handoff)) bad("chuyen_staff phải là co hoặc khong");
    customers.set(get("dinh_danh_khach"), { code, height, weight, handedOff: handoff === "co" });

    const charts = data.sizeCharts.filter((c) => c.code === code).map((c) => ({
      size: c.size, height_min_cm: c.heightMin, height_max_cm: c.heightMax,
      weight_min_kg: c.weightMin, weight_max_kg: c.weightMax,
    }));
    const recommendation = height !== undefined && weight !== undefined ? recommendSize(charts, height, weight) : undefined;
    if (get("size_dung")) {
      if (recommendation?.status !== "ok" || recommendation.size !== get("size_dung")) {
        bad(`size_dung ${get("size_dung")} không khớp bảng size và A1`);
      }
    }
    if (get("nhom") === "size") {
      const outOfRange = recommendation?.status === "out_of_range" || recommendation?.status === "no_chart";
      if (handoff !== (outOfRange ? "co" : "khong")) bad("chuyen_staff không khớp dữ liệu bảng size");
      if (recommendation?.status === "ok" && !get("size_dung")) bad("thiếu size_dung khi đủ thông tin trong bảng size");
    }

    if (get("con_hang")) {
      if (!["co", "khong"].includes(get("con_hang"))) bad("con_hang phải là co hoặc khong");
      const colors = [...new Set(data.variants.filter((v) => v.code === code).map((v) => v.color))]
        .sort((a, b) => b.length - a.length);
      const color = colors.find((value) => ` ${question} `.includes(` ${fold(value)} `));
      const variants = data.variants.filter((v) => v.code === code && v.size === size && v.color === color);
      if (!product || !size || !color || !variants.length) bad("không xác định được đúng sản phẩm, size và màu để kiểm tồn kho");
      else if ((variants.some((v) => v.stock > 0) ? "co" : "khong") !== get("con_hang")) bad("con_hang không khớp tồn kho biến thể");
    }
    if (get("gia_dung")) {
      const expected = Number(get("gia_dung"));
      const policy = data.policies.find((p) => p.kind === "giao_hang")?.content ?? "";
      const shippingFees = [...policy.matchAll(/(\d[\d.,]*)\s*(?:đ|đồng)/g)].map((m) => Number(m[1].replace(/[.,]/g, "")));
      const actualMatches = product ? product.price === expected : shippingFees.includes(expected);
      if (!Number.isSafeInteger(expected) || !actualMatches) bad("gia_dung không khớp giá sản phẩm hoặc phí giao hàng");
    }
    if (get("mon_goi_y")) {
      if (!product) bad("thiếu sản phẩm để kiểm pairing");
      else {
        const actual = resolvePairings(product.code, size, pairingRows, products, inStock).pairings.map((p) => p.productId).sort();
        const expected = get("mon_goi_y") === "khong" ? [] : get("mon_goi_y").split(";").map((s) => s.trim()).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) bad(`mon_goi_y không khớp pairing còn hàng (${actual.join("; ") || "khong"})`);
      }
    }
    if (question.includes("khuyen mai")) {
      const promotion = data.policies.find((p) => p.kind === "khuyen_mai")?.content;
      if (!promotion && handoff !== "co") bad("chính sách khuyến mãi trống cần chuyển staff");
    }
  }
  for (const product of data.products.filter((p) => !ORIGINAL_CODE.test(p.code))) {
    const collision = PROTECTED_SEARCHES.find((term) => fold(product.name).includes(term));
    if (collision) errors.push(`products ${product.code}: tên mới chứa cụm tìm kiếm được bảo vệ "${collision}"`);
  }
  return errors;
}
