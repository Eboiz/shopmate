"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { ProductCard } from "@/components/ui/product-card";
import { chatHistorySchema, type ChatMessage } from "@/lib/chat/types";
import { shopCatalogSchema, type ShopCatalog, type ShopProduct } from "@/lib/shop/types";

type Props = { slug: string };

export function ShopFront({ slug }: Props) {
  const [catalog, setCatalog] = useState<ShopCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogNotFound, setCatalogNotFound] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ShopProduct | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const refreshSequence = useRef(0);
  const pendingSend = useRef<{ text: string; productId: string | null; clientMessageId: string } | null>(null);
  const previousReplies = useRef<Set<string>>(new Set());
  const catalogEndpoint = `/api/shops/${encodeURIComponent(slug)}/catalog`;
  const endpoint = `/api/shops/${encodeURIComponent(slug)}/chat`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(catalogEndpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          setCatalogNotFound(true);
          return;
        }
        if (!response.ok) throw new Error("catalog_unavailable");
        setCatalog(shopCatalogSchema.parse(await response.json()));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError("Không tải được sản phẩm. Vui lòng thử lại.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [catalogEndpoint, catalogRetry]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Không tải được cuộc trò chuyện.");
      const data = chatHistorySchema.parse(await response.json());
      if (sequence !== refreshSequence.current) return;
      setMessages(data.messages);
      if (data.messages.some((message) => message.sender !== "shopper" && !previousReplies.current.has(message.id))) {
        setAwaitingReply(false);
      }
      setError("");
    } catch {
      if (sequence !== refreshSequence.current) return;
      setError("Không tải được cuộc trò chuyện. Vui lòng thử lại.");
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (!open) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      refreshSequence.current += 1;
    };
  }, [open, refresh]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, sending]);

  function askAbout(product: ShopProduct) {
    setSelected(product);
    setOpen(true);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setSendError("");
    refreshSequence.current += 1;
    const productId = selected?.id ?? null;
    const retry = pendingSend.current;
    const clientMessageId = retry?.text === message && retry.productId === productId
      ? retry.clientMessageId
      : crypto.randomUUID();
    pendingSend.current = { text: message, productId, clientMessageId };
    previousReplies.current = new Set(messages.filter((item) => item.sender !== "shopper").map((item) => item.id));
    let responseError = "";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message, productId, clientMessageId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        responseError = typeof data?.error === "string" && data.error !== "Failed to fetch"
          ? data.error
          : "Không gửi được tin nhắn. Vui lòng thử lại.";
        throw new Error("send_failed");
      }
      pendingSend.current = null;
      setDraft("");
      setAwaitingReply(true);
      await refresh();
    } catch {
      setAwaitingReply(false);
      setSendError(responseError || "Chưa gửi được tin nhắn. Vui lòng kiểm tra kết nối và thử lại.");
      await refresh();
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  const lastReply = messages.at(-1)?.reply;
  if (catalogLoading) {
    return <main className="flex-1 p-6 text-center text-sm text-zinc-500">Đang tải sản phẩm…</main>;
  }
  if (catalogError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <ErrorMessage>{catalogError}</ErrorMessage>
        <Button onClick={() => {
          setCatalogError("");
          setCatalogLoading(true);
          setCatalogRetry((value) => value + 1);
        }}>Thử lại</Button>
      </main>
    );
  }
  if (catalogNotFound || !catalog) {
    return (
      <main className="flex-1 p-4">
        <EmptyState title="Không tìm thấy cửa hàng" description="Vui lòng kiểm tra lại đường dẫn." />
      </main>
    );
  }
  const shopName = catalog.shop.name;
  const products = catalog.products;

  return (
    <>
      <main className="flex-1 px-4 pb-28 pt-6">
        <header className="mb-6 border-b border-zinc-200 pb-5">
          <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">Cửa hàng thời trang</p>
          <h1 className="mt-1 text-3xl font-semibold">{shopName}</h1>
          <p className="mt-2 text-sm text-zinc-600">Khám phá sản phẩm và hỏi shop ngay khi bạn cần tư vấn.</p>
        </header>
        <h2 className="mb-4 text-xl font-semibold">Sản phẩm</h2>
        {products.length === 0 ? (
          <EmptyState title="Chưa có sản phẩm" description="Vui lòng quay lại sau." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                name={product.name}
                price={product.price}
                imageUrl={product.imageUrl}
                colors={product.colors}
                sizesInStock={product.sizesInStock}
                action={
                  <Button className="w-full px-2 text-sm" onClick={() => askAbout(product)}>
                    Hỏi về món này
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </main>

      {!open && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-zinc-200 bg-white p-3 shadow-lg">
          <Button className="w-full" onClick={() => setOpen(true)}>
            Mở trò chuyện với shop
          </Button>
        </div>
      )}

      {open && (
        <section aria-label="Trò chuyện với shop" className="fixed inset-0 z-50 mx-auto flex h-dvh w-full max-w-md flex-col bg-white shadow-xl">
          <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
            <Button variant="secondary" className="px-3" onClick={() => setOpen(false)} aria-label="Đóng trò chuyện">
              ←
            </Button>
            <div className="min-w-0">
              <h2 className="truncate font-semibold">{shopName}</h2>
              <p className="text-xs text-zinc-500">Tư vấn sản phẩm</p>
            </div>
          </header>

          {selected && (
            <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm">
              <span className="min-w-0 truncate">Đang hỏi về: <strong>{selected.name}</strong></span>
              <button type="button" className="min-h-11 shrink-0 px-2 underline" onClick={() => setSelected(null)}>
                Bỏ chọn
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {loading ? (
              <p className="text-center text-sm text-zinc-500">Đang tải cuộc trò chuyện…</p>
            ) : messages.length === 0 ? (
              <EmptyState title="Bắt đầu trò chuyện" description="Hãy hỏi shop về sản phẩm, kích cỡ hoặc màu sắc." />
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={message.sender === "shopper" ? "ml-8" : "mr-8"}>
                    <p className="mb-1 text-xs text-zinc-500">
                      {message.sender === "shopper" ? "Bạn" : message.sender === "staff" ? "Nhân viên" : "Shop"}
                    </p>
                    <div className={`break-words rounded-xl p-3 text-sm ${message.sender === "shopper" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900"}`}>
                      {message.reply?.text || message.text}
                    </div>
                    {message.reply && message.reply.products.length > 0 && (
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {message.reply.products.map((product) => (
                          <ProductCard
                            key={product.productId}
                            name={product.name}
                            price={product.price}
                            imageUrl={product.imageUrl}
                            sizesInStock={product.sizesInStock}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {(sending || awaitingReply) && <p role="status" className="mt-4 text-sm text-zinc-500">Shop đang trả lời…</p>}
            <div ref={endRef} />
          </div>

          <div className="border-t border-zinc-200 bg-white p-3">
            {lastReply && lastReply.quickReplies.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {lastReply.quickReplies.map((text) => (
                  <Button key={text} variant="secondary" className="shrink-0 text-sm" disabled={sending} onClick={() => void send(text)}>
                    {text}
                  </Button>
                ))}
              </div>
            )}
            {error && <ErrorMessage className="mb-2">{error}</ErrorMessage>}
            {sendError && <ErrorMessage className="mb-2">{sendError}</ErrorMessage>}
            <form onSubmit={submit} className="flex gap-2">
              <input
                aria-label="Tin nhắn"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1000}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-zinc-300 px-3 text-base"
                placeholder="Nhập câu hỏi của bạn"
                disabled={sending || loading}
              />
              <Button type="submit" disabled={sending || loading || !draft.trim()}>
                Gửi
              </Button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
