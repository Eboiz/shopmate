// PB-10: a turn routed by Jev. Jev decided the intent and the product
// (jev.ts); this file picks the tool arguments in code, runs a fixed tool
// sequence for the intent, and says what the reply must do. The reply model then
// only writes words (engine.ts); it never sees tools.
//
// Same tools, same gate (executeTool) and same ai_turns.tool_calls logs as the
// LLM tool loop, so PB-07 and the PB-10 eval read both paths alike.
import type { EngineMode, HandoffReason, HistoryMessage, ProductCard, Reply, ToolName, ToolOutput } from "@/contract";
import { groupRank, productGroup, type ProductGroup } from "@/lib/shop/catalog-view";
import { OFFER_QUESTION, offerReply, sizeOfferText, type OfferReason } from "./handoff-offer";
import type { CatalogItem, JevDecision } from "./jev";
import { shopperMeasurements } from "./measurements";
import { productsForOccasion, productsNamedIn } from "./product-match";
import { knownShopperSize, matchingReply } from "./pairing-suggestions";
import type { SizeAdvice } from "./size-postcheck";
import { fold } from "./text";

// Below this intent confidence the turn goes to the LLM tool loop instead.
export const MIN_INTENT_CONFIDENCE = 0.6;
export const DISCOUNT_TRICK_THRESHOLD = 0.5;
export const ASKED_TO_CLARIFY_THRESHOLD = 0.5;
// Below this, the shop's policy text doesn't answer what was asked (v0.6 rule).
// Between the two calibration groups in checkPolicyCovers (0.49 / 0.66).
export const POLICY_COVERS_THRESHOLD = 0.57;
// PB-31: same idea for a product question and the product's description; same
// margin until it has its own calibration.
export const DESCRIPTION_COVERS_THRESHOLD = 0.57;
export const STAFF_BUTTON = "Gặp nhân viên";

export const ASK_PAIRING_PRODUCT_TEXT = "Bạn muốn phối cùng sản phẩm nào? Hãy chọn món hoặc cho shop biết tên sản phẩm nhé.";
export const PAIRING_FAILED_TEXT = "Shop chưa kiểm tra được món phối lúc này. Vui lòng thử lại sau nhé.";
// staff_draft notes: the reply assistant shows them to staff instead of a draft.
export const STAFF_NO_DATA_TEXT = "Dữ liệu shop chưa có thông tin này. Bạn kiểm tra sản phẩm và tự trả lời khách nhé.";
export const STAFF_NO_POLICY_TEXT = "Shop chưa viết chính sách này. Bạn tự trả lời khách nhé.";
export const STAFF_POLICY_SILENT_TEXT = "Chính sách của shop chưa nói tới điều khách hỏi. Bạn kiểm tra và tự trả lời khách nhé.";
export const STAFF_NO_SIZE_TEXT = "Số đo nằm ngoài bảng size hoặc sản phẩm chưa có bảng size, nên chưa tư vấn được size. Bạn kiểm tra và tự trả lời khách nhé.";

export type ToolResult = { ok: boolean; output: unknown; code?: string };
// Runs one tool through executeTool and records it (logs, metrics) in the engine.
export type ToolRunner = (name: ToolName, input: Record<string, unknown>) => Promise<ToolResult>;

type SizeStatus = "out_of_range" | "no_chart" | null;

export type RouteOutcome =
  | { kind: "fallback"; reason: "order" | "low_confidence" | "tool_error" }
  // customer only; handoff_to_staff already ran when viaTool is true
  | { kind: "handoff"; reason: HandoffReason; sizeStatus: SizeStatus; viaTool: boolean }
  // staff_draft complaint the server's word list missed (PB-20)
  | { kind: "personal" }
  // offer (PB-31): the reply offers staff for this reason; a "yes" next turn hands off.
  | { kind: "fixed"; reply: Reply; offer?: OfferReason }
  // The reply model writes the text; productIds are chosen here, not by the model.
  // sizeAdvice: the reply must advise exactly this size (PB-06 post-check).
  // quickReplies: the server's buttons, used instead of the model's.
  // offer: the reply ends with OFFER_QUESTION and the yes/no buttons (PB-31).
  | {
      kind: "write";
      facts: Record<string, unknown>;
      task: string;
      productIds: string[];
      sizeAdvice?: SizeAdvice;
      quickReplies?: string[];
      offer?: OfferReason;
    };

export type RouteInput = {
  mode: EngineMode;
  history: HistoryMessage[];
  decision: JevDecision;
  viewing: { id: string; name: string } | null;
  catalog: CatalogItem[];
  runTool: ToolRunner;
  cards: (productIds: string[]) => Promise<ProductCard[]>;
  // Probability that the policy text answers the shopper's question (Jev). Missing
  // or failing: the text is assumed to answer it.
  policyCovers?: (policy: string) => Promise<number>;
  // PB-31: probability that the product's description answers the question.
  // Missing or failing: assumed to answer it.
  descriptionCovers?: (product: string, description: string) => Promise<number>;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The color the shopper asked for: one of this product's colors named in their
// newest message that names one. A 1–2 letter color ("be") must follow "màu",
// so "bé" (small) is not read as beige.
export function requestedColor(history: HistoryMessage[], colors: string[]): string | null {
  const byLength = [...colors].sort((a, b) => b.length - a.length);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].sender !== "shopper") continue;
    const text = fold(history[i].text);
    for (const color of byLength) {
      const c = escape(fold(color));
      const re = c.length <= 2 ? new RegExp(`(?:^|\\W)mau\\s+${c}(?:\\W|$)`) : new RegExp(`(?:^|\\W)${c}(?:\\W|$)`);
      if (re.test(text)) return color;
    }
  }
  return null;
}

// The size the shopper asked for ("size M", "mặc L"), as the product writes it
// when it has that size.
export function requestedSize(history: HistoryMessage[], sizes: string[]): string | null {
  const size = knownShopperSize(history);
  if (size === null) return null;
  return sizes.find((s) => fold(s) === fold(size)) ?? size;
}

function resolveProduct(input: RouteInput): CatalogItem | null {
  const pick = input.decision.product;
  const id = pick.kind === "catalog" ? pick.id : pick.kind === "viewing" ? input.viewing?.id : undefined;
  if (!id) return null;
  return (
    input.catalog.find((p) => p.id === id) ??
    (input.viewing && input.viewing.id === id ? { id, name: input.viewing.name, category: null, colors: [], sizes: [] } : null)
  );
}

type Variant = ToolOutput<"get_stock">["variants"][number];
const inStock = (variants: Variant[]) =>
  variants.filter((v) => v.stock > 0).map((v) => ({ size: v.size, color: v.color, stock: v.stock }));

async function handoff(input: RouteInput, reason: HandoffReason, sizeStatus: SizeStatus = null): Promise<RouteOutcome> {
  const r = await input.runTool("handoff_to_staff", { reason });
  return { kind: "handoff", reason, sizeStatus, viaTool: r.ok };
}

const fixed = (text: string): RouteOutcome => ({ kind: "fixed", reply: { text, products: [], quickReplies: [] } });
const offer = (text: string, reason: OfferReason): RouteOutcome => ({ kind: "fixed", reply: offerReply(text), offer: reason });

// The shop's product groups (Áo, Váy & đầm …), in the shop page's order: the
// buttons of a "which one?" question.
export function catalogGroups(catalog: CatalogItem[]): ProductGroup[] {
  const groups = new Set(catalog.map((p) => productGroup(p.category, p.name)).filter((g) => g !== "Khác"));
  return [...groups].sort((a, b) => groupRank(a) - groupRank(b));
}

const lastShopperText = (history: HistoryMessage[]) => history.findLast((m) => m.sender === "shopper")?.text ?? "";

const POLICY_NAMES = { doi_tra: "đổi trả", giao_hang: "giao hàng", khuyen_mai: "khuyến mãi" } as const;

export async function routeTurn(input: RouteInput): Promise<RouteOutcome> {
  const { decision: d, mode } = input;
  const customer = mode === "customer";

  if (d.confidence !== null && d.confidence < MIN_INTENT_CONFIDENCE) return { kind: "fallback", reason: "low_confidence" };
  if (d.intent === "order") return { kind: "fallback", reason: "order" };

  // A discount or "ignore your rules" message: no other tool runs, whatever else
  // it asks (PB-17). Only the shop's own promotion text may be quoted.
  if (d.discountTrick >= DISCOUNT_TRICK_THRESHOLD && d.intent !== "complaint" && d.intent !== "human") {
    const r = await input.runTool("get_policy", { kind: "khuyen_mai" });
    const promotion = r.ok ? (r.output as ToolOutput<"get_policy">).content : null;
    return {
      kind: "write",
      facts: { promotion },
      task: promotion
        ? "Từ chối lịch sự yêu cầu giảm giá hay đổi giá ngoài chính sách. Nói ngắn gọn khuyến mãi shop đang có, đúng như nội dung promotion."
        : "Từ chối lịch sự yêu cầu giảm giá hay đổi giá: shop không giảm thêm ngoài giá niêm yết. Hỏi bạn có cần tư vấn món nào không.",
      productIds: [],
    };
  }

  switch (d.intent) {
    case "complaint":
      return customer ? handoff(input, "complaint") : { kind: "personal" };
    case "human":
      return customer
        ? handoff(input, "asked_for_human")
        : { kind: "write", facts: {}, task: "Soạn một câu ngắn cho biết nhân viên shop đang hỗ trợ trực tiếp.", productIds: [] };
    case "greeting":
      return { kind: "write", facts: {}, task: "Chào lại ngắn gọn và hỏi bạn đang tìm món gì.", productIds: [] };
    case "browse": {
      // PB-31: "shop có gì", "đồ đi tiệc": the groups as buttons, plus a few
      // products whose description fits the occasion.
      const groups = catalogGroups(input.catalog);
      const fits = productsForOccasion(lastShopperText(input.history), input.catalog, 3);
      return {
        kind: "write",
        facts: { groups, suggested: fits.map((p) => ({ name: p.name, description: p.description ?? null })) },
        task: fits.length
          ? "Giới thiệu ngắn các nhóm hàng shop có (groups), nói vài món trong suggested hợp với điều bạn hỏi (chỉ dựa trên description), rồi hỏi bạn muốn xem nhóm hay món nào. Không nêu giá."
          : "Giới thiệu ngắn các nhóm hàng shop có (groups) rồi hỏi bạn muốn xem nhóm nào. Không nêu giá.",
        productIds: fits.map((p) => p.id),
        quickReplies: groups,
      };
    }
    case "unclear":
      if (customer && d.askedToClarify >= ASKED_TO_CLARIFY_THRESHOLD) return handoff(input, "misunderstood_twice");
      return {
        kind: "write",
        facts: { groups: catalogGroups(input.catalog) },
        task: "Nếu tin nhắn không liên quan tới mua sắm ở shop, nói ngắn là bạn chỉ hỗ trợ về sản phẩm, đơn hàng và chính sách của shop. Nếu không rõ ý, hỏi lại một câu ngắn để biết bạn cần gì (sản phẩm nào; hỏi tồn kho, size, phối đồ hay chính sách).",
        productIds: [],
        quickReplies: customer ? [...catalogGroups(input.catalog).slice(0, 4), STAFF_BUTTON] : [],
      };
    case "policy": {
      const r = await input.runTool("get_policy", { kind: d.policyKind });
      if (!r.ok) return { kind: "fallback", reason: "tool_error" };
      const policy = r.output as ToolOutput<"get_policy">;
      if (policy.content === null) {
        if (!customer) return fixed(STAFF_NO_POLICY_TEXT);
        return offer(`Dạ, shop chưa có thông tin về ${POLICY_NAMES[policy.kind]} để mình trả lời chắc chắn. ${OFFER_QUESTION}`, "policy_not_covered");
      }
      const covers = input.policyCovers ? await input.policyCovers(policy.content).catch(() => 1) : 1;
      if (covers < POLICY_COVERS_THRESHOLD) {
        if (!customer) return fixed(STAFF_POLICY_SILENT_TEXT);
        // PB-31: give what the policy says that is related, say plainly what it
        // doesn't say, and offer staff.
        return {
          kind: "write",
          facts: { policy },
          task: "Chính sách của shop (policy) không nói tới đúng điều bạn hỏi. Nếu policy có ý liên quan thì nói ngắn ý đó, giữ nguyên số và điều kiện; rồi nói rõ shop chưa có thông tin về điều bạn hỏi. Không tự suy ra hay hứa điều policy không viết.",
          productIds: [],
          offer: "policy_not_covered",
        };
      }
      return {
        kind: "write",
        facts: { policy },
        task: "Trả lời câu hỏi về chính sách, chỉ dựa trên nội dung policy; giữ nguyên các con số, thời hạn và điều kiện.",
        productIds: [],
      };
    }
    default:
      break;
  }

  // stock, size, pairing: about one product.
  const product = resolveProduct(input);
  if (!product) {
    if (customer && d.askedToClarify >= ASKED_TO_CLARIFY_THRESHOLD) return handoff(input, "misunderstood_twice");
    if (d.intent === "pairing") return fixed(ASK_PAIRING_PRODUCT_TEXT);
    // PB-31: the shop doesn't have exactly what was named, but has close
    // products ("áo khoác da" -> its jackets): ask which one, with buttons.
    const close = productsNamedIn(lastShopperText(input.history), input.catalog, 3);
    if (close.length > 0) {
      return {
        kind: "write",
        facts: { closeProducts: close.map((p) => p.name) },
        task: "Shop không có đúng món bạn tả. Nói ngắn điều đó, rồi hỏi bạn có phải đang tìm một trong các món closeProducts không (nêu tên). Không nêu giá, không đoán thêm món khác.",
        productIds: close.map((p) => p.id),
        quickReplies: close.map((p) => p.name),
      };
    }
    return {
      kind: "write",
      facts: {},
      task: "Hỏi một câu ngắn: bạn đang hỏi sản phẩm nào (tên hoặc loại, màu). Không đoán sản phẩm.",
      productIds: [],
      quickReplies: customer ? catalogGroups(input.catalog) : [],
    };
  }

  if (d.intent === "product_detail") {
    // PB-31: answered only from the shop's description of the product.
    const description = product.description?.trim() || null;
    const covers = description && input.descriptionCovers
      ? await input.descriptionCovers(product.name, description).catch(() => 1)
      : description ? 1 : 0;
    if (description && covers >= DESCRIPTION_COVERS_THRESHOLD) {
      return {
        kind: "write",
        facts: { product: product.name, description },
        task: `Trả lời câu hỏi về ${product.name} chỉ dựa trên description của shop. Không thêm thông tin description không viết.`,
        productIds: [product.id],
      };
    }
    if (!customer) return fixed(STAFF_NO_DATA_TEXT);
    if (!description) return offer(`Dạ, shop chưa có thông tin này về ${product.name}. ${OFFER_QUESTION}`, "not_covered_by_data");
    return {
      kind: "write",
      facts: { product: product.name, description },
      task: `Mô tả của shop (description) không nói tới đúng điều bạn hỏi về ${product.name}. Nói ngắn những gì description có liên quan (nếu có), rồi nói rõ shop chưa có thông tin về điều bạn hỏi. Không đoán.`,
      productIds: [product.id],
      offer: "not_covered_by_data",
    };
  }

  if (d.intent === "pairing") {
    const size = knownShopperSize(input.history);
    const r = await input.runTool("get_pairings", { productId: product.id, ...(size ? { size } : {}) });
    if (!r.ok) return fixed(PAIRING_FAILED_TEXT);
    const pairings = (r.output as ToolOutput<"get_pairings">).pairings;
    const cards = pairings.length === 0 ? [] : await input.cards(pairings.map((p) => p.productId));
    return { kind: "fixed", reply: matchingReply(pairings, cards) };
  }

  if (d.intent === "size") {
    const { heightCm, weightKg } = shopperMeasurements(input.history);
    if (heightCm === null || weightKg === null) {
      const missing = [heightCm === null ? "chiều cao (cm)" : null, weightKg === null ? "cân nặng (kg)" : null].filter(Boolean);
      return {
        kind: "write",
        facts: { product: product.name, heightCm, weightKg },
        task: `Để tư vấn size ${product.name}, hỏi bạn ${missing.join(" và ")}. Chỉ hỏi đúng thông tin còn thiếu.`,
        productIds: [product.id],
      };
    }
    const r = await input.runTool("recommend_size", { productId: product.id, heightCm, weightKg });
    if (!r.ok) return { kind: "fallback", reason: "tool_error" };
    const rec = r.output as ToolOutput<"recommend_size">;
    if (rec.status !== "ok") {
      if (!customer) return fixed(STAFF_NO_SIZE_TEXT);
      // PB-31: no size is picked; the server's text says why and offers staff.
      return rec.status === "out_of_range"
        ? offer(sizeOfferText(rec), "size_out_of_range")
        : offer(sizeOfferText(null), "not_covered_by_data");
    }
    const differs = rec.sizeByHeight !== rec.sizeByWeight;
    return {
      kind: "write",
      sizeAdvice: rec,
      facts: { product: product.name, heightCm, weightKg, ...rec },
      task: differs
        ? `Tư vấn size ${rec.size} cho ${product.name}. Nói ngắn lý do: theo chiều cao là ${rec.sizeByHeight}, theo cân nặng là ${rec.sizeByWeight}, nên chọn size lớn hơn để mặc thoải mái.`
        : `Tư vấn size ${rec.size} cho ${product.name} theo chiều cao và cân nặng của bạn.`,
      productIds: [product.id],
    };
  }

  // stock
  const size = requestedSize(input.history, product.sizes);
  const color = requestedColor(input.history, product.colors);
  const asked = { size, color };
  const r = await input.runTool("get_stock", { productId: product.id, ...(size ? { size } : {}), ...(color ? { color } : {}) });
  if (!r.ok) return { kind: "fallback", reason: "tool_error" };
  const stock = r.output as ToolOutput<"get_stock">;
  const matching = inStock(stock.variants);
  const base = { product: stock.name, price: stock.price, asked };

  if ((size || color) && matching.length === 0) {
    const all = await input.runTool("get_stock", { productId: product.id });
    const others = all.ok ? inStock((all.output as ToolOutput<"get_stock">).variants) : [];
    return {
      kind: "write",
      facts: { ...base, available: false, otherOptionsInStock: others },
      task: others.length
        ? "Nói rõ biến thể bạn hỏi (size/màu trong asked) đã hết hàng, rồi gợi ý các size, màu khác của chính sản phẩm này còn hàng (otherOptionsInStock) kèm giá."
        : "Nói rõ sản phẩm này đã hết hàng.",
      productIds: others.length ? [product.id] : [],
    };
  }
  return {
    kind: "write",
    facts: { ...base, available: matching.length > 0, inStock: matching },
    task:
      size || color
        ? "Nói còn hàng biến thể bạn hỏi (size/màu trong asked), số lượng còn và giá."
        : matching.length
          ? "Báo các size và màu còn hàng (inStock) và giá; hỏi bạn muốn size, màu nào."
          : "Nói rõ sản phẩm này đã hết hàng.",
    productIds: matching.length ? [product.id] : [],
  };
}
