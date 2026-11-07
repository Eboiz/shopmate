"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { ProductCard } from "@/components/ui/product-card";
import { Icon } from "@/components/ui/icon";
import { ChatSkeleton, LoadingRegion, TypingDots } from "@/components/ui/skeleton";
import { chatHistorySchema, type ChatMessage } from "@/lib/chat/types";
import { shopCatalogSchema, type ShopCatalog, type ShopProduct } from "@/lib/shop/types";
import { ProductDetailView } from "./product-detail-view";
import { ProductDetailSkeleton, ShopFrontSkeleton } from "./shop-skeleton";

type Props = { slug: string; previewCatalog?: ShopCatalog; detailProductId?: string };

export function ShopFront({ slug, previewCatalog, detailProductId }: Props) {
  const [catalog, setCatalog] = useState<ShopCatalog | null>(previewCatalog ?? null);
  const [catalogLoading, setCatalogLoading] = useState(!previewCatalog);
  const [catalogError, setCatalogError] = useState("");
  const [catalogNotFound, setCatalogNotFound] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
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
    if (detailProductId && !catalogLoading) window.scrollTo({ top: 0, behavior: "instant" });
  }, [detailProductId, catalogLoading]);

  useEffect(() => {
    if (previewCatalog) return;
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
  }, [catalogEndpoint, catalogRetry, previewCatalog]);

  const refresh = useCallback(async () => {
    if (previewCatalog) {
      setLoading(false);
      return;
    }
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
  }, [endpoint, previewCatalog]);

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

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  function askAbout(product: ShopProduct, initialMessage?: string) {
    setSelected(product);
    if (initialMessage) setDraft(initialMessage);
    setOpen(true);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    if (previewCatalog) {
      setSendError("Đây là bản xem thử giao diện. Chat thật cần kết nối dữ liệu shop.");
      return;
    }
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
    return <main className="flex flex-1 flex-col">{detailProductId ? <ProductDetailSkeleton /> : <ShopFrontSkeleton />}</main>;
  }
  if (catalogError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <ErrorMessage>{catalogError}</ErrorMessage>
        <Button onClick={() => {
          setCatalogError("");
          setCatalogLoading(true);
          setCatalogRetry((value) => value + 1);
        }}><Icon name="refresh" className="size-4" /> Thử lại</Button>
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
  const shopHref = previewCatalog ? "/dev/shop" : `/s/${encodeURIComponent(slug)}`;
  const loginHref = previewCatalog ? "/dev/login" : "/login";
  const detailProduct = detailProductId ? products.find((product) => product.id === detailProductId) : null;
  const heroProduct = products.find((product) => product.imageUrl);
  const visibleProducts = products.filter((product) => product.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  if (sort === "price-asc") visibleProducts.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") visibleProducts.sort((a, b) => b.price - a.price);

  return (
    <>
      <main className="flex-1">
        {detailProductId ? detailProduct ? (
          <ProductDetailView
            key={detailProduct.id}
            shopName={shopName}
            product={detailProduct}
            shopHref={shopHref}
            loginHref={loginHref}
            onAsk={askAbout}
          />
        ) : (
          <section className="mx-auto max-w-4xl px-4 py-24 text-center">
            <EmptyState title="Không tìm thấy sản phẩm" description="Sản phẩm này không còn trong cửa hàng." />
            <Link href={shopHref} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#171717] px-5 text-sm font-semibold text-white">Về cửa hàng</Link>
          </section>
        ) : <>
        <div className="bg-[#171717] px-4 py-2 text-center text-[10px] font-bold uppercase tracking-[.16em] text-white sm:text-xs">Tìm đúng món đồ bạn yêu · Tư vấn cùng ShopMate 24/7</div>
        <header className="sticky top-0 z-20 border-b border-[#e3dfd8] bg-white/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
            <a href="#dau-trang" className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center bg-[#171717] text-xl font-black text-white">S</span><span className="flex min-w-0 items-baseline text-lg font-black uppercase tracking-[-.05em] sm:text-xl"><h1 className="truncate">{shopName}</h1><span aria-hidden="true" className="text-[#e9573f]">.</span></span></a>
            <nav aria-label="Điều hướng cửa hàng" className="hidden items-center gap-8 text-xs font-bold uppercase tracking-[.12em] md:flex"><a href="#san-pham" className="hover:text-[#e9573f]">Sản phẩm</a><a href="#tro-ly" className="hover:text-[#e9573f]">Tư vấn</a></nav>
            <div className="flex shrink-0 items-center gap-2"><Link href={loginHref} aria-label="Đăng nhập quản lý" title="Đăng nhập quản lý" className="inline-flex min-h-10 items-center gap-2 border border-[#d5d0c8] px-3 text-xs font-bold uppercase tracking-[.08em] transition-colors hover:border-[#171717] hover:bg-[#f5f3ef]"><Icon name="login" className="size-4" /><span className="hidden lg:inline">Đăng nhập</span></Link><button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-[#171717] px-3 text-xs font-bold uppercase tracking-[.08em] transition-colors hover:bg-[#171717] hover:text-white sm:px-4"><Icon name="chat" className="size-4" /><span className="hidden sm:inline">Chat ngay</span><span className="sm:hidden">Chat</span></button></div>
          </div>
        </header>

        <section id="dau-trang" className="relative overflow-hidden bg-[#171717] text-white">
          <div className="mx-auto grid min-h-[560px] max-w-[1400px] lg:grid-cols-[1.05fr_.95fr]">
            <div className="ui-enter relative z-10 flex flex-col justify-center px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
              <p className="mb-6 text-xs font-bold uppercase tracking-[.24em] text-[#ff8d75]">ShopMate / New perspective</p>
              <p className="max-w-2xl text-[clamp(3.5rem,8vw,8rem)] font-black uppercase leading-[.88] tracking-[-.09em]">Wear<br /><span className="text-[#e9573f]">your</span><br />story<span className="text-[#e9573f]">.</span></p>
              <p className="mt-7 max-w-md text-sm leading-7 text-[#d4d1ca] sm:text-base">Khám phá sản phẩm của {shopName}. Chọn đúng màu, đúng size và hoàn thiện phong cách của riêng bạn.</p>
              <div className="mt-8 flex flex-wrap gap-3"><a href="#san-pham" className="group inline-flex min-h-12 items-center gap-3 bg-[#e9573f] px-5 text-xs font-bold uppercase tracking-[.1em] text-white transition-colors hover:bg-[#d4442e]">Khám phá ngay <Icon name="arrow" className="size-4 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" /></a><button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-12 items-center gap-2 border border-[#6e6e6e] px-5 text-xs font-bold uppercase tracking-[.1em] hover:border-white"><Icon name="spark" className="size-4" /> Hỏi stylist AI</button></div>
            </div>
            <div className="ui-enter ui-enter-delay relative min-h-[320px] overflow-hidden bg-[#33312d] lg:min-h-full">
              {heroProduct?.imageUrl ? <Image src={heroProduct.imageUrl} alt={heroProduct.name} fill priority sizes="(max-width: 1024px) 100vw, 48vw" className="object-cover opacity-90" /> : <Image src="/hero-texture.png" alt="" fill priority sizes="(max-width: 1024px) 100vw, 48vw" className="object-cover" />}
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4 border-t border-white/50 pt-3 text-white sm:bottom-8 sm:left-8 sm:right-8"><p className="text-xs font-bold uppercase tracking-[.18em]">Curated for you<br /><span className="font-normal normal-case tracking-normal text-[#d4d1ca]">Một diện mạo mới mỗi ngày</span></p><span className="text-3xl font-black">01 / 01</span></div>
            </div>
          </div>
        </section>
        <div aria-hidden="true" className="overflow-hidden border-y border-[#171717] bg-[#e9573f] py-3 text-[#171717]"><div className="ui-marquee text-xs font-black uppercase tracking-[.22em]"><span className="shrink-0 px-5">Style your day ✳ Find your fit ✳ Make it yours ✳ Style your day ✳ Find your fit ✳ Make it yours ✳</span><span className="shrink-0 px-5">Style your day ✳ Find your fit ✳ Make it yours ✳ Style your day ✳ Find your fit ✳ Make it yours ✳</span></div></div>

        <section id="san-pham" className="mx-auto max-w-[1400px] scroll-mt-24 px-4 py-14 sm:px-6 sm:py-20 lg:px-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="ui-eyebrow mb-3">The shop edit / 2026</p><h2 className="ui-page-title">Khám phá sản phẩm<span className="text-[#e9573f]">.</span></h2><p className="mt-3 text-sm text-[#706d67]">Những lựa chọn dành cho phong cách của bạn.</p></div><p className="text-sm font-semibold tabular-nums text-[#706d67]">{visibleProducts.length} / {products.length} sản phẩm</p></div>
          {products.length > 0 && <div className="mb-7 flex flex-col gap-3 border-y border-[#e3dfd8] py-4 sm:flex-row sm:items-center sm:justify-between"><label className="flex min-h-11 items-center gap-2 border-b border-[#bcb8b0] sm:min-w-72"><Icon name="search" className="size-4 shrink-0 text-[#706d67]" /><span className="sr-only">Tìm sản phẩm</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm..." className="w-full bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#8b8881]" /></label><label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em]">Sắp xếp <select value={sort} onChange={(event) => setSort(event.target.value)} className="min-h-11 border border-[#d5d0c8] bg-white px-3 text-sm font-medium normal-case tracking-normal"><option value="featured">Mặc định</option><option value="price-asc">Giá thấp đến cao</option><option value="price-desc">Giá cao đến thấp</option></select></label></div>}
          {products.length === 0 ? <EmptyState title="Chưa có sản phẩm" description="Vui lòng quay lại sau." /> : visibleProducts.length === 0 ? <EmptyState title="Không tìm thấy sản phẩm" description="Thử tìm bằng tên sản phẩm khác." /> : <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{visibleProducts.map((product) => <ProductCard key={product.id} href={`${shopHref}/p/${encodeURIComponent(product.id)}`} name={product.name} price={product.price} imageUrl={product.imageUrl} colors={product.colors} sizesInStock={product.sizesInStock} />)}</div>}
        </section>

        <section id="tro-ly" className="bg-[#e9e5dc]"><div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-6 px-4 py-12 sm:px-6 lg:flex-row lg:items-center lg:px-10"><div><p className="ui-eyebrow mb-3">Your personal shopping assistant</p><h2 className="text-3xl font-black uppercase tracking-[-.06em] sm:text-5xl">Chưa chắc về size?<br /><span className="text-[#e9573f]">Cứ hỏi ShopMate.</span></h2><p className="mt-4 max-w-xl text-sm leading-6 text-[#706d67]">Hỏi về giá, tồn kho, màu sắc hoặc gợi ý phối đồ ngay trên trang này.</p></div><Button onClick={() => setOpen(true)} className="min-h-12 px-6 text-xs uppercase tracking-[.1em]">Bắt đầu trò chuyện <Icon name="arrow" className="size-4" /></Button></div></section>
        <footer className="bg-[#171717] px-4 py-9 text-white sm:px-6 lg:px-10"><div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-5"><div><p className="text-2xl font-black uppercase tracking-[-.06em]">{shopName}<span className="text-[#e9573f]">.</span></p><p className="mt-2 text-xs text-[#aaa69f]">Được hỗ trợ bởi ShopMate</p></div><a href="#dau-trang" className="text-xs font-bold uppercase tracking-[.12em] hover:text-[#e9573f]">Lên đầu trang ↑</a></div></footer>
        </>}
      </main>

      {!open && !detailProductId && (
        <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
          <Button className="min-h-14 rounded-full border border-[#ffffff33] bg-[#171717] px-5 text-white shadow-[0_16px_35px_-12px_#171717aa] hover:bg-[#e9573f]" aria-label="Mở trò chuyện với shop" onClick={() => setOpen(true)}>
            <Icon name="chat" className="size-5" /><span className="sm:hidden">Chat với shop</span><span className="hidden sm:inline">Cần tư vấn? Chat ngay</span><span aria-hidden="true" className="ml-1 size-2 rounded-full bg-[#70dc8f]" />
          </Button>
        </div>
      )}

      {open && (
        <section aria-label="Trò chuyện với shop" className="ui-chat-enter fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(700px,calc(100dvh-2.5rem))] sm:w-[420px] sm:rounded-xl sm:border sm:border-[#e3dfd8]">
          <header className="flex items-center gap-3 bg-[#171717] px-4 py-4 text-white">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#e9573f]"><Icon name="spark" className="size-5" /></span>
            <div className="min-w-0 flex-1"><h2 className="truncate font-bold">{shopName} <span className="text-[#e9573f]">/</span> ShopMate</h2><p className="text-xs text-[#bbb8b2]">Tư vấn mua sắm · Sẵn sàng hỗ trợ</p></div>
            <button type="button" className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[#ffffff44] transition-colors hover:bg-white hover:text-[#171717]" onClick={() => setOpen(false)} aria-label="Đóng trò chuyện"><Icon name="close" className="size-4" /></button>
          </header>

          {selected && (
            <div className="flex items-center justify-between gap-2 border-b border-[#e3dfd8] bg-[#efebe4] px-4 py-2 text-sm">
              <span className="min-w-0 truncate">Đang hỏi về: <strong>{selected.name}</strong></span>
              <button type="button" className="min-h-11 shrink-0 px-2 underline" onClick={() => setSelected(null)}>
                Bỏ chọn
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f5f3ef] px-4 py-5" aria-live="polite">
            {loading ? (
              <LoadingRegion label="Đang tải cuộc trò chuyện…"><ChatSkeleton /></LoadingRegion>
            ) : messages.length === 0 ? (
              <div className="space-y-5"><div className="ui-card p-5"><span className="flex size-10 items-center justify-center rounded-lg bg-[#e9573f] text-white"><Icon name="spark" className="size-5" /></span><h3 className="mt-4 text-lg font-bold">Xin chào! Mình giúp gì cho bạn?</h3><p className="mt-2 text-sm leading-6 text-[#706d67]">Hỏi về sản phẩm, size, màu sắc hoặc một set đồ hợp với bạn.</p></div><div><p className="mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#706d67]">Gợi ý câu hỏi</p><div className="flex flex-wrap gap-2">{["Shop còn size M không?", "Tư vấn size giúp mình", "Gợi ý phối đồ"].map((text) => <button key={text} type="button" onClick={() => void send(text)} disabled={sending || loading} className="rounded-full border border-[#d5d0c8] bg-white px-3 py-2 text-xs font-medium transition-colors hover:border-[#171717] disabled:opacity-50">{text} ↗</button>)}</div></div></div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={message.sender === "shopper" ? "ml-8" : "mr-8"}>
                    <p className="mb-1 text-xs text-[#706d67]">
                      {message.sender === "shopper" ? "Bạn" : message.sender === "staff" ? "Nhân viên" : "Shop"}
                    </p>
                    <div className={`break-words rounded-xl p-3 text-sm leading-6 ${message.sender === "shopper" ? "rounded-br-sm bg-[#171717] text-white" : "rounded-bl-sm border border-[#e3dfd8] bg-white text-[#171717]"}`}>
                      {message.reply?.text || message.text}
                    </div>
                    {message.reply && message.reply.products.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {message.reply.products.map((product) => (
                          <ProductCard
                            key={product.productId}
                            compact
                            href={`${shopHref}/p/${encodeURIComponent(product.productId)}`}
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
            {(sending || awaitingReply) && (
              <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-xl rounded-bl-sm border border-[#e3dfd8] bg-white px-3 py-2 text-sm text-[#706d67]">
                <TypingDots /> Shop đang trả lời…
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[#e3dfd8] bg-white p-3">
            {previewCatalog && <p className="mb-2 text-xs text-[#706d67]">Bản xem thử giao diện — chưa kết nối chat.</p>}
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
                className="ui-field min-h-11 min-w-0 flex-1 px-3 text-base"
                placeholder="Nhập câu hỏi của bạn"
                disabled={sending || loading}
              />
              <Button type="submit" disabled={loading || !draft.trim()} loading={sending} loadingText={<span className="hidden sm:inline">Gửi</span>} aria-label="Gửi tin nhắn"><Icon name="send" className="size-4" /><span className="hidden sm:inline">Gửi</span></Button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
