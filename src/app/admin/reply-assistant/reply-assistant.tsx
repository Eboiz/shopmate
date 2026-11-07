"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { ProductCard } from "@/components/ui/product-card";
import { TextArea } from "@/components/ui/text-area";
import type { EngineOutput } from "@/contract";

type Draft = { question: string; text: string; products: EngineOutput["reply"]["products"] };
type DraftStatus = "idle" | "loading" | "personal" | "error";
type CopyState = "idle" | "copying" | "copied" | "manual";

export function ReplyAssistant({ generateDraftAction }: {
  generateDraftAction?: (question: string) => Promise<EngineOutput>;
}) {
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [copy, setCopy] = useState<CopyState>("idle");
  const draftField = useRef<HTMLTextAreaElement>(null);
  const busy = status === "loading" || copy === "copying";
  const hasChangedQuestion = draft !== undefined && draft.question !== question.trim();
  const canCopy = Boolean(draft?.text.trim()) && !busy && !hasChangedQuestion && status !== "personal";

  function changeQuestion(text: string) {
    setQuestion(text);
    setStatus("idle");
    setCopy("idle");
  }

  async function createDraft() {
    const text = question.trim();
    if (!generateDraftAction || !text || busy) return;

    setStatus("loading");
    setCopy("idle");

    try {
      const result = await generateDraftAction(text);
      if (result.personalReplyNeeded) {
        setStatus("personal");
      } else if (result.reply.text.trim() || result.reply.products.length) {
        setDraft({ question: text, text: result.reply.text, products: result.reply.products });
        setStatus("idle");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  async function copyDraft(text: string) {
    if (!canCopy) return;
    setCopy("copying");

    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      draftField.current?.focus();
      draftField.current?.select();
      setCopy("manual");
    }
  }

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      <form
        className="min-w-0 space-y-3 rounded-lg border border-zinc-300 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void createDraft();
        }}
      >
        <TextArea
          label="Câu hỏi của khách"
          rows={4}
          required
          readOnly={busy}
          value={question}
          className="w-full min-w-0"
          onChange={(event) => changeQuestion(event.target.value)}
        />
        {!generateDraftAction && (
          <p role="status" className="text-sm">Tính năng tạo bản nháp đang chờ kết nối với engine.</p>
        )}
        <Button type="submit" disabled={!generateDraftAction || busy || !question.trim()}>
          {status === "loading" ? "Đang soạn…" : status === "error" ? "Thử lại" : "Tạo bản nháp"}
        </Button>
      </form>

      <section className="min-w-0 space-y-3 rounded-lg border border-zinc-300 p-4" aria-labelledby="draft-heading">
        <h2 id="draft-heading" className="font-semibold">Bản nháp trả lời</h2>
        {!draft && status === "idle" && (
          <EmptyState title="Chưa có bản nháp" description="Nhập câu hỏi của khách để bắt đầu." />
        )}
        {status === "loading" && <p role="status" className="text-sm">Đang tạo bản nháp trả lời…</p>}
        {status === "error" && <ErrorMessage>Chưa tạo được bản nháp. Vui lòng thử lại.</ErrorMessage>}
        {status === "personal" && (
          <div role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Hãy tự trả lời khách</p>
            <p className="mt-1">Đây là khiếu nại. Hãy đọc lại nội dung và phản hồi trực tiếp cho khách.</p>
          </div>
        )}
        {draft && (
          <>
            {hasChangedQuestion && <p className="text-sm">Nội dung bên dưới là bản nháp của câu hỏi trước.</p>}
            <TextArea
              ref={draftField}
              label="Nội dung trả lời có thể sửa"
              rows={5}
              readOnly={busy}
              value={draft.text}
              className="w-full min-w-0"
              onChange={(event) => {
                setDraft({ ...draft, text: event.target.value });
                setCopy("idle");
              }}
            />
            <Button disabled={!canCopy} onClick={() => void copyDraft(draft.text)}>
              {copy === "copying" ? "Đang sao chép…" : "Sao chép"}
            </Button>
            <div role="status" className="text-sm">{copy === "copied" && "Đã sao chép câu trả lời."}</div>
            {copy === "manual" && (
              <ErrorMessage>Vui lòng dùng thao tác sao chép của trình duyệt với nội dung đã chọn.</ErrorMessage>
            )}
            {draft.products.length > 0 && (
              <ul aria-label="Sản phẩm trong bản nháp" className="grid grid-cols-2 gap-2">
                {draft.products.map(({ productId, ...product }) => (
                  <li key={productId} className="min-w-0"><ProductCard {...product} /></li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
