"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { TextArea } from "@/components/ui/text-area";
import { demoQuestions, generateReplyDraft } from "./reply-draft";

type DraftState =
  | { status: "idle" | "loading" | "personal" | "error" }
  | { status: "ready"; text: string };

type CopyState = "idle" | "copying" | "copied" | "manual";

export function ReplyAssistant() {
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<DraftState>({ status: "idle" });
  const [copy, setCopy] = useState<CopyState>("idle");
  const draftField = useRef<HTMLTextAreaElement>(null);
  const busy = draft.status === "loading" || copy === "copying";

  function changeQuestion(text: string) {
    setQuestion(text);
    setDraft({ status: "idle" });
    setCopy("idle");
  }

  async function createDraft() {
    const text = question.trim();
    if (!text || busy) return;

    setDraft({ status: "loading" });
    setCopy("idle");

    try {
      const result = await generateReplyDraft(text);
      if (result.personalReplyNeeded) {
        setDraft({ status: "personal" });
      } else if (result.reply.text.trim()) {
        setDraft({ status: "ready", text: result.reply.text });
      } else {
        setDraft({ status: "error" });
      }
    } catch {
      setDraft({ status: "error" });
    }
  }

  async function copyDraft(text: string) {
    if (!text.trim() || busy) return;
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
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Câu hỏi mẫu">
          <Button variant="secondary" disabled={busy} onClick={() => changeQuestion(demoQuestions.product)}>
            Câu hỏi mẫu
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => changeQuestion(demoQuestions.complaint)}>
            Khiếu nại mẫu
          </Button>
        </div>
        <Button type="submit" disabled={busy || !question.trim()}>
          {draft.status === "loading" ? "Đang soạn…" : draft.status === "error" ? "Thử lại" : "Tạo bản nháp"}
        </Button>
      </form>

      <section className="min-w-0 space-y-3 rounded-lg border border-zinc-300 p-4" aria-labelledby="draft-heading">
        <h2 id="draft-heading" className="font-semibold">Bản nháp trả lời</h2>
        {draft.status === "idle" && (
          <EmptyState title="Chưa có bản nháp" description="Nhập câu hỏi của khách để bắt đầu." />
        )}
        {draft.status === "loading" && <p role="status" className="text-sm">Đang tạo bản nháp trả lời…</p>}
        {draft.status === "error" && <ErrorMessage>Chưa tạo được bản nháp. Vui lòng thử lại.</ErrorMessage>}
        {draft.status === "personal" && (
          <div role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Hãy tự trả lời khách</p>
            <p className="mt-1">Đây là khiếu nại. Hãy đọc lại nội dung và phản hồi trực tiếp cho khách.</p>
          </div>
        )}
        {draft.status === "ready" && (
          <>
            <TextArea
              ref={draftField}
              label="Nội dung trả lời có thể sửa"
              rows={5}
              readOnly={copy === "copying"}
              value={draft.text}
              className="w-full min-w-0"
              onChange={(event) => {
                setDraft({ status: "ready", text: event.target.value });
                setCopy("idle");
              }}
            />
            <Button disabled={busy || !draft.text.trim()} onClick={() => void copyDraft(draft.text)}>
              {copy === "copying" ? "Đang sao chép…" : "Sao chép"}
            </Button>
            <div role="status" className="text-sm">{copy === "copied" && "Đã sao chép câu trả lời."}</div>
            {copy === "manual" && (
              <ErrorMessage>Vui lòng dùng thao tác sao chép của trình duyệt với nội dung đã chọn.</ErrorMessage>
            )}
          </>
        )}
      </section>
    </div>
  );
}
