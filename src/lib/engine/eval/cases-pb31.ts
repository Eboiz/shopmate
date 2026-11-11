// PB-31 (fewer handoffs) eval cases on shop A of the two-shop fixture.
//
// "replay" (ids replay-*): the 18 shopper messages of the handoff log in #32
// ("Handoffs in the last 7 days"), the ×4 and ×3 rows as 4 and 3 cases (the first
// in the logged words, the others reworded the way shoppers write it), each with
// the result the issue's "Expected" column asks for.
// "near matches" (ids near-*): typos, no diacritics, other names for a product,
// and measurements just outside the size chart.
//
// Shop A (two-shops.ts): Váy suông linen (váy, chart S/M/L up to 172 cm / 60 kg),
// Áo sơ mi trắng (áo, no chart), Quần ống rộng, Áo blazer (đen S), Áo khoác
// bomber, Áo khoác jean, Quần jean ống đứng. Policies: doi_tra "Đổi trong 7
// ngày", giao_hang blank, no khuyen_mai.
import type { HistoryMessage, ToolCallLog } from "@/contract";
import { findUnbackedDiscount } from "../discount-guard";
import { OFFER_YES, sizeOfferText } from "../handoff-offer";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase, ExpectedCall, OutcomeLabel } from "./cases";

const V = FX.a.vay01;
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const foldedIncludes = (part: string) => (v: unknown) => typeof v === "string" && fold(v).includes(part);

const ANSWER: OutcomeLabel = { decision: "answer" };
const offer = (reason: "policy_not_covered" | "not_covered_by_data" | "size_out_of_range"): OutcomeLabel => ({
  decision: "offer",
  reason,
});
const handoff = (reason: "asked_for_human" | "complaint" | "misunderstood_twice"): OutcomeLabel => ({
  decision: "handoff",
  reason,
});

const SIZES = ["xs", "s", "m", "l", "xl", "xxl"];
const sizeTokens = (text: string) => SIZES.filter((s) => new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`).test(fold(text)));
// The reply names this size and no other (the size function's nearest size).
const namesOnlySize = (size: string) => (t: string) => {
  const said = sizeTokens(t);
  return said.length === 1 && said[0] === size.toLowerCase();
};
const namesNoSize = (t: string) => sizeTokens(t).length === 0;
const mentionsStaff = (t: string) => fold(t).includes("nhan vien");
const noDiscount = (t: string) => findUnbackedDiscount(t, ["Đổi trong 7 ngày"]) === null;
const offersStaffButton = { label: "offers staff as a quick reply", ok: (q: string[]) => q.includes(OFFER_YES) };

const sizeAt = (heightCm: number, weightKg: number): ExpectedCall => ({
  tool: "recommend_size",
  args: { productId: V, heightCm, weightKg },
  required: true,
});
const stockMaybe: ExpectedCall = { tool: "get_stock", required: false };
const searchRequired: ExpectedCall = { tool: "search_products", required: true };
const handoffMaybe: ExpectedCall = { tool: "handoff_to_staff", required: false };

// ---------------------------------------------------------------- replay ----

// "Shop có giao hàng vào Chủ nhật không?" (Mây, ×4). The issue expects an answer
// from giao_hang once the PO writes the delivery days into the seed. The fixture's
// giao_hang for shop A is blank (other cases rely on that, and get_policy reads one
// row per kind), so ON THIS FIXTURE the right result is an offer of staff with
// policy_not_covered, never an invented delivery day.
const sunday = (n: number, text: string): EvalCase => ({
  id: `replay-sunday-delivery-${n}`,
  description:
    "PB-31 replay (Mây ×4): delivery on Sunday. Fixture-dependent: shop A's giao_hang is blank, so offer staff " +
    "(policy_not_covered); on the seeded shop with delivery days it is an answer.",
  shouldHandOff: true,
  history: shopper(text),
  expected: [{ tool: "get_policy", args: { kind: "giao_hang" }, required: true }, handoffMaybe],
  outcome: offer("policy_not_covered"),
  reply: { label: "mentions staff", ok: mentionsStaff },
  quickReplies: offersStaffButton,
});

// "Mình lấy 2 cái, shop bớt cho mình 50k được không?" (Mây, ×3): refused, no
// discount, no handoff and no offer (prompt v1.2, PB-17).
const discount = (n: number, text: string): EvalCase => ({
  id: `replay-discount-50k-${n}`,
  description: "PB-31 replay (Mây ×3): asks for 50k off two items; refused from the data, no handoff, no offer.",
  shouldHandOff: false,
  history: shopper(text),
  productId: V,
  expected: [
    { tool: "get_policy", args: { kind: "khuyen_mai" }, required: false },
    stockMaybe,
    { tool: "quote_order", required: false },
  ],
  outcome: ANSWER,
  reply: { label: "agrees to no discount", ok: noDiscount },
});

// The size turn the "tên nhân viên" message followed (the logged bug: that
// message was handed off as size_out_of_range, left over from this turn).
const SIZE_TURN: ToolCallLog[] = [
  {
    name: "recommend_size",
    input: { productId: V, heightCm: 180, weightKg: 80 },
    output: { status: "out_of_range", nearestSize: "L", offCm: 8, offKg: 20 },
  },
];

export const pb31ReplayCases: EvalCase[] = [
  sunday(1, "Shop có giao hàng vào Chủ nhật không?"),
  sunday(2, "Chủ nhật shop có giao hàng không ạ?"),
  sunday(3, "chu nhat shop co giao hang ko"),
  sunday(4, "Đặt hôm nay thì Chủ nhật có giao tới không shop?"),
  discount(1, "Mình lấy 2 cái, shop bớt cho mình 50k được không?"),
  discount(2, "Lấy 2 cái váy này shop bớt 50k nha"),
  discount(3, "mua 2 cai bot cho minh 50k duoc ko shop"),
  {
    id: "replay-return-not-fit",
    description: "PB-31 replay (Mây, Bug): returns question answered from doi_tra (7 ngày), no handoff, no offer.",
    shouldHandOff: false,
    history: shopper("Mua về mặc không vừa thì đổi được không shop?"),
    expected: [{ tool: "get_policy", args: { kind: "doi_tra" }, required: true }],
    outcome: ANSWER,
    reply: { label: "says 7 ngày", ok: (t) => /\b7\s*ngay\b/.test(fold(t)) },
  },
  {
    id: "replay-order-blazer",
    description: "PB-31 replay (Hạnh, Bug): 'cho mua 1 áo blazer màu đen size S' goes into the order flow (AI-03), never asked_for_human.",
    shouldHandOff: false,
    history: shopper("cho mua 1 áo blazer màu đen size S"),
    expected: [
      { tool: "search_products", args: { query: foldedIncludes("blazer") }, required: true },
      { tool: "get_stock", args: { productId: FX.a.blazer }, required: false },
      { tool: "quote_order", required: false },
      { tool: "create_draft_order", required: false },
    ],
    finds: FX.a.blazer,
    outcome: ANSWER,
    reply: { label: "talks about the blazer", ok: (t) => fold(t).includes("blazer") },
  },
  {
    id: "replay-what-products",
    description: "PB-31 replay (Hạnh, Bug): 'có những sản phẩm gì' lists the shop's groups with quick replies, not a misunderstood turn.",
    shouldHandOff: false,
    history: shopper("hiện tại bên mình có những sản phẩm gì"),
    expected: [{ tool: "search_products", required: false }],
    outcome: ANSWER,
    quickReplies: { label: "at least 2 quick replies (groups or products)", ok: (q) => q.length >= 2 && !q.includes(OFFER_YES) },
  },
  {
    id: "replay-staff-name",
    description:
      "PB-31 replay (Hạnh, Bug): asks the name of the staff member, right after a size turn outside the chart. " +
      "Never size_out_of_range: hand off for asked_for_human, or offer staff for not_covered_by_data.",
    shouldHandOff: true,
    history: [
      { sender: "shopper", text: "nặng 80kg cao 1m8 mặc váy này size gì" },
      { sender: "ai", text: sizeOfferText({ nearestSize: "L", offCm: 8, offKg: 20 }) },
      { sender: "shopper", text: "Tôi có thể biết tên nhân viên sắp tư vấn cho tôi không?" },
    ],
    productId: V,
    previousTurn: SIZE_TURN,
    expected: [handoffMaybe],
    outcome: [handoff("asked_for_human"), offer("not_covered_by_data")],
  },
  {
    id: "replay-leather-jacket",
    description:
      "PB-31 replay (Mây): 'áo khoác da' is not in the shop; say so, show the closest jackets as quick replies and ask which. No handoff.",
    shouldHandOff: false,
    history: shopper("loại áo khoác da màu đen ấy"),
    expected: [{ tool: "search_products", args: { query: foldedIncludes("khoac") }, required: true }, stockMaybe],
    finds: FX.a.bomber,
    outcome: ANSWER,
    reply: { label: "asks a question", ok: (t) => t.includes("?") },
    quickReplies: {
      label: "a close jacket as a quick reply",
      ok: (q) => q.some((x) => /bomber|khoac jean/.test(fold(x))),
    },
  },
  {
    id: "replay-owner-meet",
    description: "PB-31 replay: 'cho gặp chủ shop' asks for a person; immediate handoff, unchanged.",
    shouldHandOff: true,
    history: shopper("cho gặp chủ shop"),
    expected: [{ tool: "handoff_to_staff", args: { reason: "asked_for_human" }, required: false }],
    outcome: handoff("asked_for_human"),
    reply: { label: "mentions staff", ok: mentionsStaff },
  },
  {
    id: "replay-owner-call",
    description: "PB-31 replay: 'kêu chủ ra' asks for the owner; immediate handoff (a complaint reading is also immediate).",
    shouldHandOff: true,
    history: shopper("kêu chủ ra"),
    expected: [
      { tool: "handoff_to_staff", args: { reason: (v: unknown) => v === "asked_for_human" || v === "complaint" }, required: false },
    ],
    outcome: [handoff("asked_for_human"), handoff("complaint")],
  },
  {
    id: "replay-owner-name",
    description: "PB-31 replay: the owner's name is off-topic; the AI says it only helps with the shop's products and offers staff.",
    shouldHandOff: true,
    history: shopper("tên của chủ shop"),
    expected: [handoffMaybe],
    outcome: offer("not_covered_by_data"),
    quickReplies: offersStaffButton,
  },
  {
    id: "replay-off-topic",
    description: "PB-31 replay: 'php2shell là gì' is off-topic; the AI says it only helps with the shop's products and offers staff.",
    shouldHandOff: true,
    history: shopper("php2shell là gì"),
    expected: [handoffMaybe],
    outcome: offer("not_covered_by_data"),
    quickReplies: offersStaffButton,
  },
  {
    id: "replay-size-180-80",
    description: "PB-31 replay (Hạnh): 180 cm / 80 kg is far past the chart; no size, offer staff (soft handoff).",
    shouldHandOff: true,
    history: shopper("nặng 80kg cao 1m8"),
    productId: V,
    expected: [sizeAt(180, 80), stockMaybe, handoffMaybe],
    outcome: offer("size_out_of_range"),
    reply: { label: "names no size, mentions staff", ok: (t) => namesNoSize(t) && mentionsStaff(t) },
  },
  {
    id: "replay-size-300-100",
    description:
      "PB-31 replay (Hạnh): '100kg, cao 3m' (100 kg alone is past the chart; 3 m is not a height the tools take); no size, offer staff.",
    shouldHandOff: true,
    history: shopper("100kg, cao 3m"),
    productId: V,
    expected: [{ tool: "recommend_size", args: { productId: V }, required: false }, stockMaybe, handoffMaybe],
    outcome: offer("size_out_of_range"),
    reply: { label: "names no size", ok: namesNoSize },
  },
];

// ---------------------------------------------------------- near matches ----

const near = (id: string, text: string, finds: string, description: string): EvalCase => ({
  id: `near-${id}`,
  description: `PB-31 near match: ${description}; search finds the product (exact or close), no handoff, no offer.`,
  shouldHandOff: false,
  history: shopper(text),
  expected: [searchRequired, stockMaybe],
  finds,
  outcome: ANSWER,
});

// Just outside the chart (≤ 3 cm and ≤ 3 kg): name the size function's nearest
// size, say it may be tight, offer staff. Further out: no size, offer staff.
const nearSize = (id: string, text: string, h: number, w: number, nearest: string | null): EvalCase => ({
  id: `near-size-${id}`,
  description:
    nearest === null
      ? `PB-31 size past the chart by more than 3 cm / 3 kg (${h} cm / ${w} kg): no size, offer staff.`
      : `PB-31 size just outside the chart (${h} cm / ${w} kg): names ${nearest} from recommend_size, offers staff.`,
  shouldHandOff: true,
  history: shopper(text),
  productId: V,
  expected: [sizeAt(h, w), stockMaybe, handoffMaybe],
  outcome: offer("size_out_of_range"),
  reply:
    nearest === null
      ? { label: "names no size", ok: namesNoSize }
      : { label: `names ${nearest} only, mentions staff`, ok: (t) => namesOnlySize(nearest)(t) && mentionsStaff(t) },
  quickReplies: offersStaffButton,
});

export const pb31NearCases: EvalCase[] = [
  near("typo-linen", "Shop có váy suông lenin không?", V, "typo 'lenin'"),
  near("typo-blazer", "ao blazzer den con size S ko shop", FX.a.blazer, "typo 'blazzer', no diacritics"),
  near("no-diacritics-jean", "quan jean ong dung con size M khong", FX.a.jean, "no diacritics"),
  near("no-diacritics-somi", "ao so mi trang con size S khong shop", FX.a.ao03, "no diacritics"),
  near("dam-vay", "Shop có đầm suông linen không?", V, "đầm = váy"),
  near("quan-bo-jean", "Shop có quần bò không?", FX.a.jean, "quần bò = quần jean"),
  near("somi", "áo somi trắng còn size S không?", FX.a.ao03, "somi = sơ mi"),
  near("jacket-bomber", "Shop có jacket bomber không?", FX.a.bomber, "jacket = áo khoác"),
  near("jacket-jean", "có jacket jean không shop", FX.a.jacketJean, "jacket jean = áo khoác jean"),
  nearSize("taller", "Mình cao 1m74 nặng 58kg mặc váy này size nào?", 174, 58, "L"),
  nearSize("heavier", "Mình cao 1m70 nặng 62kg thì mặc size gì?", 170, 62, "L"),
  nearSize("edge-3cm-3kg", "cao 1m75 nặng 63 ký mặc size nào", 175, 63, "L"),
  // Below the chart the smallest size would be loose, so no size is named (review).
  nearSize("shorter", "Mình cao 1m48 nặng 42kg mặc size nào?", 148, 42, null),
  nearSize("past-4cm", "Mình cao 1m76 nặng 60kg mặc size nào?", 176, 60, null),
];

export const pb31Cases: EvalCase[] = [...pb31ReplayCases, ...pb31NearCases];
