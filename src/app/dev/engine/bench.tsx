"use client";

import { useState } from "react";

type Card = { productId: string; name: string; price: number; imageUrl: string | null; sizesInStock: string[] };
type Metrics = {
  latencyMs: number;
  ttftMs: number | null;
  inputTokens: number;
  outputTokens: number;
  modelCalls: unknown[];
  toolCalls: Array<{ name: string; ms: number; outcome: string }>;
  duplicateToolCalls: number;
};
type Turn = {
  role: "shopper" | "ai";
  text: string;
  products?: Card[];
  quickReplies?: Array<string | { label?: string; text?: string }>;
  debug?: { handoffReason: string | null; conversationMode: string | null; personalReplyNeeded: boolean; turnId: string | null; metrics: Metrics | null };
  error?: boolean;
};

const label = (q: string | { label?: string; text?: string }) => (typeof q === "string" ? q : (q.label ?? q.text ?? JSON.stringify(q)));

export function EngineBench() {
  const [mode, setMode] = useState<"customer" | "staff_draft">("customer");
  const [shopSlug, setShopSlug] = useState("");
  const [productId, setProductId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTurns([]);
    setConversationId(null);
  };

  async function send(message: string) {
    const msg = message.trim();
    if (!msg || busy) return;
    const next: Turn[] = [...turns, { role: "shopper", text: msg }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/dev/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          history: next.map((t) => ({ sender: t.role, text: t.text })),
          productId: productId.trim() || null,
          conversationId,
          shopSlug: shopSlug.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConversationId(data.conversationId);
      setTurns([
        ...next,
        {
          role: "ai",
          text: data.reply.text,
          products: data.reply.products,
          quickReplies: data.reply.quickReplies,
          debug: {
            handoffReason: data.handoffReason,
            conversationMode: data.conversationMode,
            personalReplyNeeded: data.personalReplyNeeded,
            turnId: data.turnId,
            metrics: data.metrics,
          },
        },
      ]);
    } catch (e) {
      setTurns([...next, { role: "ai", text: String(e instanceof Error ? e.message : e), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-3 p-4 text-zinc-900">
      <h1 className="text-lg font-semibold">Engine test bench (dev only)</h1>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className={input} value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); reset(); }}>
          <option value="customer">customer</option>
          <option value="staff_draft">staff_draft</option>
        </select>
        <input className={input} placeholder="shop slug (trống = shop demo)" value={shopSlug} onChange={(e) => setShopSlug(e.target.value)} />
        <input className={`${input} w-72`} placeholder="productId (tuỳ chọn, như bấm 'Hỏi về món này')" value={productId} onChange={(e) => setProductId(e.target.value)} />
        <button className="rounded border border-zinc-300 bg-white px-2 py-1" onClick={reset}>Hội thoại mới</button>
      </div>
      <p className="text-xs text-zinc-500">
        {conversationId ? `conversation: ${conversationId}` : "chưa có hội thoại, sẽ tạo khi gửi tin đầu"}
      </p>

      <div className="flex flex-1 flex-col gap-3">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "shopper" ? "self-end" : "self-start"}>
            <div className={`max-w-md whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${t.role === "shopper" ? "bg-blue-600 text-white" : t.error ? "bg-red-100 text-red-800" : "bg-zinc-100"}`}>
              {t.text}
            </div>
            {t.products && t.products.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {t.products.map((p) => (
                  <div key={p.productId} className="w-40 rounded border border-zinc-200 bg-white p-2 text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="mb-1 h-24 w-full rounded object-cover" />}
                    <div className="font-medium">{p.name}</div>
                    <div>{p.price.toLocaleString("vi-VN")}đ</div>
                    <div className="text-zinc-500">Còn size: {p.sizesInStock.join(", ") || "hết"}</div>
                    <button className="mt-1 text-blue-600 underline" onClick={() => setProductId(p.productId)}>dùng làm productId</button>
                  </div>
                ))}
              </div>
            )}
            {t.quickReplies && t.quickReplies.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {t.quickReplies.map((q, j) => (
                  <button key={j} className="rounded-full border border-blue-600 px-2 py-0.5 text-xs text-blue-700" onClick={() => send(label(q))}>
                    {label(q)}
                  </button>
                ))}
              </div>
            )}
            {t.debug && (
              <details className="mt-1 text-xs text-zinc-600">
                <summary className="cursor-pointer">
                  {t.debug.metrics ? `${t.debug.metrics.latencyMs}ms · ${t.debug.metrics.toolCalls.length} tool · ${t.debug.metrics.inputTokens}/${t.debug.metrics.outputTokens} tok` : "debug"}
                  {t.debug.handoffReason ? ` · handoff: ${t.debug.handoffReason}` : ""}
                  {t.debug.conversationMode && t.debug.conversationMode !== "ai" ? ` · conversation: ${t.debug.conversationMode}` : ""}
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2">{JSON.stringify(t.debug, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
        {busy && <div className="self-start text-sm text-zinc-500">AI đang trả lời…</div>}
      </div>

      <form className="sticky bottom-0 flex gap-2 bg-white py-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <input className={`${input} flex-1`} placeholder="Nhập tin nhắn của khách…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50" disabled={busy || !text.trim()}>Gửi</button>
      </form>
    </main>
  );
}
