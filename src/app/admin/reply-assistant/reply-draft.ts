import type { EngineOutput } from "@/contract";

export const demoQuestions = {
  product: "Áo sơ mi linen còn cỡ M không shop?",
  complaint: "Áo mình nhận được bị rách, shop hỗ trợ giúp mình với.",
};

// The server can replace this demo function with a staff_draft engine call.
export async function generateReplyDraft(question: string): Promise<EngineOutput> {
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  const normalized = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const personalReplyNeeded = /\b(khieu nai|bi rach|bi hong|bi loi|giao sai|giao thieu)\b/.test(normalized);
  let text = "Dạ, shop đã nhận được câu hỏi của bạn. Shop sẽ kiểm tra thông tin và phản hồi lại bạn sớm ạ.";

  if (personalReplyNeeded) {
    text = "";
  } else if (question === demoQuestions.product) {
    text = "Dạ, shop sẽ kiểm tra tồn kho áo sơ mi linen cỡ M và báo lại bạn ngay ạ.";
  }

  return { reply: { text, products: [], quickReplies: [] }, personalReplyNeeded };
}
