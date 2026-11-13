// PB-39 post-check: the reply says the shop has no price, stock or policy
// information ("giá thì mình chưa có thông tin", "chưa có phí giao hàng") while
// this turn's tool results hold exactly that, or it promises to check and get
// back later ("để mình kiểm tra và cập nhật"), a step that doesn't exist. Like
// the size and discount checks, runEngine regenerates once, then sends a reply
// written from the tool results with the product cards. Pure: no IO.
import { tools, type PolicyKind, type ToolCallLog, type ToolOutput } from "@/contract";
import { formatPrice } from "@/lib/format";
import { sizeFallbackText, type SizeAdvice } from "./size-postcheck";
import { fold } from "./text";

export type MissingClaim = "price" | "stock" | PolicyKind | "promise";

const POLICY_NAMES: Record<PolicyKind, string> = { doi_tra: "đổi trả", giao_hang: "giao hàng", khuyen_mai: "khuyến mãi" };

// "chưa có thông tin", "chưa có giá", "không rõ", "chưa nắm được": the reply says
// it doesn't know. A plain "chưa có màu đỏ" (the data says there is none) is not one.
const MISSING =
  /\b(chua|khong) (co|nam duoc|nam|xac dinh duoc|xac dinh) (thong tin|du lieu|gia|bang gia|muc phi|phi)\b|\bchua (duoc )?cap nhat\b|\bchua (ro|biet|nam)\b|\bkhong (ro|biet)\b|\bchua (the )?bao gia\b/;

// What a "missing" clause is about, on folded text.
const TOPICS: Record<Exclude<MissingClaim, "promise">, RegExp> = {
  price: /\b(gia|bang gia|bao gia)\b|bao nhieu tien/,
  stock: /con hang|ton kho|het hang|\bmau\b|so luong/,
  giao_hang: /\bship\b|giao hang|van chuyen|phi giao|freeship/,
  doi_tra: /doi tra|doi hang|tra hang|hoan tien/,
  khuyen_mai: /khuyen mai|giam gia|uu dai|voucher|ma giam/,
};

// "để mình kiểm tra và cập nhật", "check lại rồi báo bạn sau", "cập nhật cho bạn sớm".
const PROMISE =
  /\b(kiem tra|check|xem)( lai)?( (va|roi|xong))? (cap nhat|bao|phan hoi)\b|\bcap nhat (lai |them )?(cho ban|sau|som|ngay)\b|\b(bao|phan hoi) lai (cho ban|ban|sau|som)\b|\bde (minh|shop) (kiem tra|check)\b/;

const okLogs = (logs: readonly ToolCallLog[]) => logs.filter((l) => !l.error && l.output !== undefined);

type ReadTool = "get_stock" | "search_products" | "get_pairings" | "quote_order" | "get_policy";
function parsed<T extends ReadTool>(log: ToolCallLog, name: T): ToolOutput<T> | null {
  const r = tools[name].output.safeParse(log.output);
  return r.success ? (r.data as ToolOutput<T>) : null;
}

// The kinds of data this turn's tools returned.
function dataTopics(logs: readonly ToolCallLog[]): Set<Exclude<MissingClaim, "promise">> {
  const found = new Set<Exclude<MissingClaim, "promise">>();
  for (const log of okLogs(logs)) {
    if (log.name === "get_stock" && parsed(log, "get_stock")) found.add("price").add("stock");
    if (log.name === "search_products" && (parsed(log, "search_products")?.products.length ?? 0) > 0) found.add("price");
    if (log.name === "get_pairings" && (parsed(log, "get_pairings")?.pairings.length ?? 0) > 0) found.add("price");
    if (log.name === "quote_order" && (parsed(log, "quote_order")?.lines.length ?? 0) > 0) found.add("price");
    if (log.name === "get_policy") {
      const policy = parsed(log, "get_policy");
      if (policy?.content) found.add(policy.kind);
    }
  }
  return found;
}

// What the reply wrongly says is missing, plus "promise" for a promised update.
// offer: the reply offers staff (PB-31), so saying a policy doesn't cover the
// question is allowed; a missing price or stock still isn't. customer: the
// promise is checked only for replies the shopper gets directly.
export function falseMissingClaims(
  text: string,
  logs: readonly ToolCallLog[],
  opts: { customer: boolean; offer?: boolean },
): MissingClaim[] {
  const clauses = fold(text).split(/[.!?\n;]+/);
  const has = dataTopics(logs);
  const claims = new Set<MissingClaim>();
  for (const clause of clauses) {
    if (MISSING.test(clause)) {
      for (const [topic, re] of Object.entries(TOPICS) as [Exclude<MissingClaim, "promise">, RegExp][]) {
        const policy = topic !== "price" && topic !== "stock";
        if (opts.offer && policy) continue;
        if (has.has(topic) && re.test(clause)) claims.add(topic);
      }
    }
    if (opts.customer && PROMISE.test(clause)) claims.add("promise");
  }
  return [...claims];
}

// Sent to the model once when its reply failed the check.
export function missingRetryNote(claims: readonly MissingClaim[]): string {
  const parts = claims.flatMap((c) =>
    c === "price" ? ["giá"] : c === "stock" ? ["size, màu còn hàng"] : c === "promise" ? [] : [`chính sách ${POLICY_NAMES[c]}`],
  );
  const lines = ["Kiểm tra tự động:"];
  if (parts.length) {
    lines.push(`câu trả lời nói chưa có thông tin về ${parts.join(", ")} nhưng dữ liệu lượt này đã có. Viết lại và nêu đúng ${parts.join(", ")} từ dữ liệu (giá viết dạng 289.000đ).`);
  }
  lines.push("Không hứa kiểm tra rồi cập nhật hay báo lại sau: không có bước đó. Điều dữ liệu không có thì nói rõ là shop chưa có thông tin.");
  return lines.join(" ");
}

// The latest ok output of each product's get_stock, in call order.
function latestStocks(logs: readonly ToolCallLog[]) {
  const byProduct = new Map<string, ToolOutput<"get_stock">>();
  for (const log of okLogs(logs)) {
    const stock = log.name === "get_stock" ? parsed(log, "get_stock") : null;
    if (stock) byProduct.set(stock.productId, stock);
  }
  return [...byProduct.values()];
}

function latestSearch(logs: readonly ToolCallLog[]) {
  const log = okLogs(logs).findLast((l) => l.name === "search_products");
  return log ? parsed(log, "search_products")?.products.slice(0, 3) ?? [] : [];
}

// Products whose cards go with the fallback: get_stock's, else the search's.
export function productIdsInLogs(logs: readonly ToolCallLog[]): string[] {
  const stocks = latestStocks(logs);
  return stocks.length ? stocks.map((s) => s.productId) : latestSearch(logs).map((p) => p.productId);
}

// The reply written from this turn's tool results: the size advice, each
// product's price and what is in stock, and the policy text (only the kinds in
// `policyKinds` when given). null when the turn looked nothing up.
export function dataReplyText(
  logs: readonly ToolCallLog[],
  sizeAdvice: SizeAdvice | null,
  policyKinds?: readonly MissingClaim[],
): string | null {
  const lines: string[] = [];
  if (sizeAdvice) lines.push(sizeFallbackText(sizeAdvice));
  const stocks = latestStocks(logs);
  for (const s of stocks) {
    const available = s.variants.filter((v) => v.stock > 0).map((v) => `size ${v.size} màu ${v.color}`);
    lines.push(`${s.name} giá ${formatPrice(s.price)}. ${available.length ? `Còn hàng: ${available.join(", ")}.` : "Hiện đã hết hàng."}`);
  }
  if (stocks.length === 0) {
    for (const p of latestSearch(logs)) lines.push(`${p.name} giá ${formatPrice(p.price)}.`);
  }
  const policies = new Map<PolicyKind, string>();
  for (const log of okLogs(logs)) {
    const policy = log.name === "get_policy" ? parsed(log, "get_policy") : null;
    if (policy?.content && (!policyKinds || policyKinds.includes(policy.kind))) policies.set(policy.kind, policy.content.trim());
  }
  for (const [kind, content] of policies) lines.push(`Chính sách ${POLICY_NAMES[kind]} của shop: ${content}`);
  if (lines.length === 0) return null;
  const text = lines.join("\n");
  const withGreeting = text.startsWith("Dạ") ? text : `Dạ, ${text}`;
  return withGreeting.length <= 1000 ? withGreeting : `${withGreeting.slice(0, 999).trimEnd()}…`;
}
