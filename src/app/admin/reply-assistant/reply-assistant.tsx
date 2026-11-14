"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/text-area";
import type { EngineOutput } from "@/contract";
import { formatPrice, formatSizesInStock } from "@/lib/format";

type Product = EngineOutput["reply"]["products"][number];
type Draft = { question: string; text: string; products: Product[] };
type DraftStatus = "idle" | "loading" | "personal" | "error";
type CopyState = "idle" | "copying" | "copied" | "manual";

// Five lines to start, growing with the text up to twelve, so a short draft
// leaves room for the product list below it. Phones keep seven lines.
const growingField = "w-full min-w-0 resize-y field-sizing-content min-h-[calc(5lh+1rem+2px)] max-h-[calc(12lh+1rem+2px)] max-lg:min-h-[calc(7lh+1rem+2px)]";

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
        className="ui-card min-w-0 space-y-5 p-5 sm:p-7 lg:space-y-4 lg:p-6"
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
          rows={5}
          maxLength={1000}
          required
          readOnly={busy}
          value={question}
          className={growingField}
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

      <section className="ui-card min-w-0 space-y-5 p-5 sm:p-7 lg:space-y-4 lg:p-6" aria-labelledby="draft-heading" aria-live="polite">
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
              rows={5}
              readOnly={busy}
              value={draft.text}
              className={growingField}
              onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setCopy("idle"); }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={!canCopy} onClick={() => void copyDraft()}>
                {copy === "copying" ? "Đang sao chép…" : copy === "copied" ? "Đã sao chép" : "Sao chép câu trả lời"}
              </Button>
              {copy === "copied" && <span role="status" className="text-sm text-[#39724c]">Sẵn sàng để dán vào cuộc trò chuyện.</span>}
            </div>
            {copy === "manual" && <ErrorMessage>Không thể sao chép tự động. Hãy sao chép phần văn bản đã được chọn.</ErrorMessage>}
            {draft.products.length > 0 && <RelatedProducts products={draft.products} />}
          </>
        )}
      </section>
    </div>
  );
}

// Compact rows right under the copy button, so staff see which products the
// draft mentions before they copy it. When rows fall below the screen, a
// sticky note says how many are left and scrolls to the first one.
function RelatedProducts({ products }: { products: Product[] }) {
  const list = useRef<HTMLUListElement>(null);
  const [hidden, setHidden] = useState<Element[]>([]);

  useEffect(() => {
    const rows = Array.from(list.current?.children ?? []);
    const below = new Set<Element>();
    // The bottom margin keeps a row under the sticky note counted as hidden.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const bottom = entry.rootBounds?.bottom ?? window.innerHeight;
        if (entry.intersectionRatio < 1 && entry.boundingClientRect.bottom > bottom) below.add(entry.target);
        else below.delete(entry.target);
      }
      setHidden(rows.filter((row) => below.has(row)));
    }, { threshold: [0, 1], rootMargin: "0px 0px -48px 0px" });
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [products]);

  return (
    <div className="space-y-2 border-t border-[#e3dfd8] pt-3">
      <h3 className="text-sm font-bold">Sản phẩm liên quan <span className="font-normal text-[#706d67]">({products.length})</span></h3>
      <ul ref={list} aria-label="Sản phẩm trong bản nháp" className="divide-y divide-[#e3dfd8] rounded-xl border border-[#e3dfd8]">
        {products.map(({ productId, name, price, imageUrl, sizesInStock }) => (
          <li key={productId} className="flex min-w-0 items-center gap-3 px-3 py-1.5">
            <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-[#eeebe5]">
              <Image src={imageUrl ?? "/images/product-placeholder.jpg"} alt="" fill sizes="40px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#171717]" title={name}>{name}</span>
              <span className="block truncate text-xs text-[#706d67]">{formatSizesInStock(sizesInStock)}</span>
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-[#c2412b]">{formatPrice(price)}</span>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <button
          type="button"
          className="sticky bottom-20 mx-auto lg:bottom-3 flex items-center gap-1.5 rounded-full bg-[#171717] px-4 py-2 text-xs font-semibold text-white shadow-lg"
          onClick={() => hidden[0]?.scrollIntoView({ behavior: "smooth", block: "center" })}
        >
          <Icon name="chevron" className="size-4" />
          Còn {hidden.length} sản phẩm bên dưới
        </button>
      )}
    </div>
  );
}
