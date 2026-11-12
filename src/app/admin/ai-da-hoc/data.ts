import "server-only";
import type { Database, Tables } from "@/contract";
import { gapWindowStart } from "@/lib/engine/data-gap";
import { POLICY_LABELS } from "@/lib/shop-data-validation";
import { createClient } from "@/lib/supabase/server";

// Reads for /admin/ai-da-hoc (PB-35a) through the signed-in user's client:
// owner and staff can both read; RLS keeps them to their own shop.

type LearningMode = Database["public"]["Enums"]["learning_mode"];

const REVIEW_REASONS: Record<string, string> = {
  discount: "Có nhắc giảm giá",
  conflict: "Mâu thuẫn với chính sách đang có",
  vague: "Nhân viên trả lời chưa chắc",
  unverified: "Câu học được có thể khác ý nhân viên",
  model: "AI đề nghị chủ shop xem lại",
};
const PRODUCT_REVIEW = "Thông tin sản phẩm, cần chủ shop duyệt";

// Shown only on "Chưa ai trả lời"; product_not_found rows go to "Món chưa có".
const GAP_REASONS: Partial<Record<Database["public"]["Enums"]["gap_reason"], string>> = {
  policy_not_covered: "Chính sách chưa nói tới",
  not_covered_by_data: "Dữ liệu shop chưa có",
};

const vnTime = new Intl.DateTimeFormat("vi-VN", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

export type FactView = {
  id: string;
  text: string;
  label: string;
  reasons: string[];
  staffText: string | null;
  question: string | null;
  conversationId: string | null;
  time: string;
};

export type GapView = {
  id: string;
  question: string;
  reasonLabel: string;
  softDeclined: boolean;
  conversationId: string;
  time: string;
};

export type LearningPageData = {
  mode: LearningMode;
  pending: FactView[];
  learned: FactView[];
  questions: GapView[];
  requests: GapView[];
};

export async function getLearningPage(shopId: string): Promise<LearningPageData> {
  const db = await createClient();
  const [shop, facts, gaps] = await Promise.all([
    db.from("shops").select("learning_mode").eq("id", shopId).single(),
    db
      .from("learned_facts")
      .select("id, text, status, policy_kind, review_reasons, created_at, products(name), messages(text, conversation_id), data_gaps(conversation_id, question)")
      .eq("shop_id", shopId)
      .in("status", ["active", "pending"])
      .order("created_at", { ascending: false })
      .limit(1, { referencedTable: "data_gaps" }),
    db
      .from("data_gaps")
      .select("id, conversation_id, reason, question, soft_declined, created_at")
      .eq("shop_id", shopId)
      .eq("status", "open")
      .gte("created_at", gapWindowStart())
      .order("created_at", { ascending: false }),
  ]);
  if (shop.error) throw new Error(`shops: ${shop.error.message}`);
  if (facts.error) throw new Error(`learned_facts: ${facts.error.message}`);
  if (gaps.error) throw new Error(`data_gaps: ${gaps.error.message}`);

  const toFact = (f: (typeof facts.data)[number]): FactView => {
    const gap = f.data_gaps[0];
    const reasons = f.review_reasons.map((r) => REVIEW_REASONS[r] ?? r);
    if (f.products) reasons.push(PRODUCT_REVIEW);
    return {
      id: f.id,
      text: f.text,
      label: f.products ? `Sản phẩm · ${f.products.name}` : `Chính sách · ${f.policy_kind ? POLICY_LABELS[f.policy_kind] : ""}`,
      reasons,
      staffText: f.messages?.text ?? null,
      question: gap?.question ?? null,
      conversationId: f.messages?.conversation_id ?? gap?.conversation_id ?? null,
      time: vnTime.format(new Date(f.created_at)),
    };
  };
  const toGap = (g: Pick<Tables<"data_gaps">, "id" | "question" | "reason" | "soft_declined" | "conversation_id" | "created_at">): GapView => ({
    id: g.id,
    question: g.question,
    reasonLabel: GAP_REASONS[g.reason] ?? "",
    softDeclined: g.soft_declined,
    conversationId: g.conversation_id,
    time: vnTime.format(new Date(g.created_at)),
  });

  return {
    mode: shop.data.learning_mode,
    pending: facts.data.filter((f) => f.status === "pending").map(toFact),
    learned: facts.data.filter((f) => f.status === "active").map(toFact),
    questions: gaps.data.filter((g) => g.reason !== "product_not_found").map(toGap),
    requests: gaps.data.filter((g) => g.reason === "product_not_found").map(toGap),
  };
}
