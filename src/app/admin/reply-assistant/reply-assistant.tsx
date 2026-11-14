"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { ProductCard } from "@/components/ui/product-card";
import { TextArea } from "@/components/ui/text-area";
import type { EngineOutput } from "@/contract";

type Draft = { question: string; text: string; products: EngineOutput["reply"]["products"] };
type DraftStatus = "idle" | "loading" | "personal" | "error";
type CopyState = "idle" | "copying" | "copied" | "manual";

export function ReplyAssistant({ generateDraftAction }: {
  generateDraftAction: (question: string) => Promise<EngineOutput>;
}) {
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [copy, setCopy] = useState<CopyState>("idle");
  const draftField = useRef<HTMLTextAreaElement>(null);
  const requestId = useRef(0);
  const busy = status === "loading" || copy === "copying";
  const hasChangedQuestion = draft !== undefined && draft.question !== question.trim();
  const canCopy = Boolean(draft?.text.trim()) && !busy && !hasChangedQuestion && status !== "personal";

  function changeQuestion(value: string) {
    requestId.current += 1;
    setQuestion(value);
    setStatus("idle");
    setCopy("idle");
  }

  async function createDraft() {
    const text = question.trim();
    if (!text || busy) return;
    const id = ++requestId.current;
    setStatus("loading");
    setCopy("idle");
    setDraft(undefined);
    try {
      const result = await generateDraftAction(text);
      if (id !== requestId.current) return;
      if (result.personalReplyNeeded) {
        setStatus("personal");
      } else if (result.reply.text.trim() || result.reply.products.length) {
        setDraft({ question: text, text: result.reply.text, products: result.reply.products });
        setStatus("idle");
      } else {
        setStatus("error");
      }
    } catch {
      if (id === requestId.current) setStatus("error");
    }
  }

  async function copyDraft() {
    if (!canCopy || !draft) return;
    setCopy("copying");
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopy("copied");
    } catch {
      draftField.current?.focus();
      draftField.current?.select();
      setCopy("manual");
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <form
        className="ui-card min-w-0 space-y-5 p-5 sm:p-7"
        onSubmit={(event) => { event.preventDefault(); void createDraft(); }}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#efebe4] text-[#e9573f]"><Icon name="chat" className="size-5" /></span>
          <div>
            <h2 className="text-lg font-bold text-[#171717]">Câu hỏi của khách</h2>
            <p className="mt-1 text-sm text-[#706d67]">Dán nguyên văn để trợ lý hiểu đúng nội dung.</p>
          </div>
        </div>
        <TextArea
          label="Nội dung cần trả lời"
          rows={7}
          maxLength={1000}
          required
          readOnly={busy}
          value={question}
          className="w-full min-w-0 resize-y"
          placeholder="Ví dụ: Áo này còn size M không?"
          onChange={(event) => changeQuestion(event.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-[#706d67]">{question.length}/1000 ký tự</span>
          <Button type="submit" disabled={busy || !question.trim()}>
            <Icon name={status === "loading" ? "refresh" : "spark"} className="size-4" />
            {status === "loading" ? "Đang soạn…" : status === "error" ? "Thử lại" : "Tạo bản nháp"}
          </Button>
        </div>
      </form>

      <section className="ui-card min-w-0 space-y-5 p-5 sm:p-7" aria-labelledby="draft-heading" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#171717] text-white"><Icon name="spark" className="size-5" /></span>
          <div>
            <h2 id="draft-heading" className="text-lg font-bold text-[#171717]">Bản nháp trả lời</h2>
            <p className="mt-1 text-sm text-[#706d67]">Kiểm tra và chỉnh sửa trước khi gửi cho khách.</p>
          </div>
        </div>

        {!draft && status === "idle" && <EmptyState icon="spark" title="Chưa có bản nháp" description="Nhập câu hỏi của khách rồi chọn Tạo bản nháp." />}
        {status === "loading" && <div role="status" className="rounded-xl border border-[#e3dfd8] bg-[#f5f3ef] px-5 py-10 text-center text-sm text-[#706d67]">ShopMate đang soạn câu trả lời…</div>}
        {status === "error" && <ErrorMessage>Chưa tạo được bản nháp. Vui lòng thử lại.</ErrorMessage>}
        {status === "personal" && (
          <div role="status" className="rounded-xl border border-[#f3d3c9] bg-[#fff6f3] p-5 text-sm text-[#7a2a1d]">
            <p className="font-bold">Hãy tự trả lời khách</p>
            <p className="mt-2 leading-6">Đây là khiếu nại. Hãy đọc lại nội dung và phản hồi trực tiếp cho khách.</p>
          </div>
        )}
        {draft && (
          <>
            {hasChangedQuestion && <p className="rounded-lg bg-[#fff0eb] p-3 text-sm text-[#9f3b2b]">Đây là bản nháp của câu hỏi trước. Hãy tạo lại bản nháp cho câu hỏi mới.</p>}
            <TextArea
              ref={draftField}
              label="Nội dung trả lời có thể sửa"
              rows={7}
              readOnly={busy}
              value={draft.text}
              className="w-full min-w-0 resize-y"
              onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setCopy("idle"); }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={!canCopy} onClick={() => void copyDraft()}>
                {copy === "copying" ? "Đang sao chép…" : copy === "copied" ? "Đã sao chép" : "Sao chép câu trả lời"}
              </Button>
              {copy === "copied" && <span role="status" className="text-sm text-[#39724c]">Sẵn sàng để dán vào cuộc trò chuyện.</span>}
            </div>
            {copy === "manual" && <ErrorMessage>Không thể sao chép tự động. Hãy sao chép phần văn bản đã được chọn.</ErrorMessage>}
            {draft.products.length > 0 && (
              <div className="space-y-3 border-t border-[#e3dfd8] pt-5">
                <h3 className="text-sm font-bold">Sản phẩm liên quan</h3>
                <ul aria-label="Sản phẩm trong bản nháp" className="grid gap-3 sm:grid-cols-2">
                  {draft.products.map(({ productId, ...product }) => (
                    <li key={productId} className="min-w-0"><ProductCard {...product} /></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
