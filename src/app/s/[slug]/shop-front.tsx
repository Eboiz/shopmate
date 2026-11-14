"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { ProductCard } from "@/components/ui/product-card";
import { ChatSkeleton, LoadingRegion, TypingDots } from "@/components/ui/skeleton";
import type { ConversationMode } from "@/contract";
import { chatStatus } from "@/lib/chat/chat-status";
import { preparePhoto } from "@/lib/chat/prepare-photo";
import { chatHistorySchema, type ChatMessage } from "@/lib/chat/types";
import { SEARCH_MIN_TEXT, searchErrors, searchResponseSchema } from "@/lib/search/request";
import { applyResult, searchLabel, type SearchResult, type SearchState } from "@/lib/search/search-state";
import { compareSizes } from "@/lib/size-order";
import { displayColor, firstSentence, groupRank, matchesQuery, OTHER_GROUP, PRODUCT_GROUPS, productGroup, readShopFilters, searchFromQuery, shopFilterQuery, type ProductGroup, type ShopFilters, type ShopSort } from "@/lib/shop/catalog-view";
import { shopCatalogSchema, type ShopCatalog, type ShopProduct } from "@/lib/shop/types";
import { cartCount, cartMessage, stockChangeMessage, useCart, variantStock, type CartItem } from "./cart";
import { onlyChoice, productOptions } from "./product-options";
import { cartItemFor, QuickAdd } from "./quick-add";
import { CartPanel } from "./cart-panel";
import { ProductDetailView } from "./product-detail-view";
import { ProductDetailSkeleton, ShopFrontSkeleton } from "./shop-skeleton";
import { SmartSearch } from "./smart-search";
import { GroupTiles, ShopFooter, ShopHeader, ShopHero, ShopMarquee, SizeBand, type GroupLink } from "./storefront-sections";

type Props = { slug: string; previewCatalog?: ShopCatalog; detailProductId?: string };

const PAGE_SIZE = 12;

export function ShopFront({ slug, previewCatalog, detailProductId }: Props) {
  const [catalog, setCatalog] = useState<ShopCatalog | null>(previewCatalog ?? null);
  const [catalogLoading, setCatalogLoading] = useState(!previewCatalog);
  const [catalogError, setCatalogError] = useState("");
  const [catalogNotFound, setCatalogNotFound] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [open, setOpen] = useState(false);
  // Filters live in the URL. The search box keeps its own state: Next updates
  // useSearchParams inside a transition, which would drop keystrokes.
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchFromQuery(searchParams));
  // PB-34: description/photo search of the grid. The photo is only kept in the
  // page (A1); searchSeq drops answers of a search that is no longer the latest.
  // photoSeq drops a photo whose preparation ends after a newer pick or a reset.
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [searchPhoto, setSearchPhoto] = useState<Blob | null>(null);
  const searchSeq = useRef(0);
  const photoSeq = useRef(0);
  // Leaves the description/photo search: drops any pending answer and goes back
  // to the instant filter; dropPhoto also forgets the photo (and one still being
  // prepared). Only refs and state setters, so it is stable across renders.
  const endSearch = useCallback((dropPhoto: boolean) => {
    searchSeq.current += 1;
    setSearchState({ status: "idle" });
    if (dropPhoto) {
      photoSeq.current += 1;
      setSearchPhoto(null);
    }
  }, []);
  // The latest typed text, for a photo whose preparation ends after more typing.
  const searchTextRef = useRef("");
  // How many products "Xem thêm" has revealed, for one set of filters.
  const [more, setMore] = useState({ key: "", count: PAGE_SIZE });
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useCart(slug);
  // The order message the cart put in the chat; the cart empties once it is sent.
  const cartMessageRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<ShopProduct | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // PB-30: one photo waiting to be sent (already checked and shrunk), and its preview URL.
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoError, setPhotoError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [awaitingReply, setAwaitingReply] = useState(false);
  // The conversation's mode from the last poll (PB-42): outside `ai` no AI
  // turn runs, so the chat says it is waiting for staff instead of typing.
  const [mode, setMode] = useState<ConversationMode>("ai");
  // The message being sent, shown straight away: POST only answers once the
  // whole AI turn is done, which can take several seconds. knownIds are the
  // messages already on screen, so the stored copy can replace this one.
  const [outgoing, setOutgoing] = useState<{ text: string; knownIds: Set<string> } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Whether new content should pull the log down: true while the shopper is
  // at (or near) the bottom, false once they scroll up to read older messages.
  const stickToBottom = useRef(true);
  const mainRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The control that opened the chat gets focus back when it closes.
  const openerRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLButtonElement>(null);
  const mobileChatRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const refreshSequence = useRef(0);
  const pendingSend = useRef<{ text: string; productId: string | null; photo: Blob | null; clientMessageId: string } | null>(null);
  const previousReplies = useRef<Set<string>>(new Set());
  // A question asked from the page (header, hero, chips, size form) while the
  // chat was closed or still loading; sent once its history is in.
  const queuedAsk = useRef<string | null>(null);
  const catalogEndpoint = `/api/shops/${encodeURIComponent(slug)}/catalog`;
  const endpoint = `/api/shops/${encodeURIComponent(slug)}/chat`;

  useEffect(() => {
    if (detailProductId && !catalogLoading) window.scrollTo({ top: 0, behavior: "instant" });
  }, [detailProductId, catalogLoading]);

  // A link to "#san-pham" (the detail page's group breadcrumb) lands before the
  // catalog has loaded, so the grid isn't there for the browser to scroll to yet.
  const hashScrolled = useRef(false);
  useEffect(() => {
    if (detailProductId || catalogLoading || hashScrolled.current) return;
    hashScrolled.current = true;
    if (window.location.hash === "#san-pham") document.getElementById("san-pham")?.scrollIntoView({ block: "start" });
  }, [detailProductId, catalogLoading]);

  // The search box takes the URL's search on back/forward, and when a link
  // brings back this page, which Next keeps alive (Activity) with its old state.
  useLayoutEffect(() => {
    const syncSearch = () => setSearch(searchFromQuery(new URLSearchParams(window.location.search)));
    syncSearch();
    // Back/forward also leaves a description/photo search (PB-34).
    const onPopState = () => {
      endSearch(true);
      syncSearch();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [endSearch]);
  useEffect(() => {
    searchTextRef.current = search;
  }, [search]);

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
      setMode(data.mode);
      if (data.mode !== "ai" || data.messages.some((message) => message.sender !== "shopper" && !previousReplies.current.has(message.id))) {
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

  // Each poll replaces `messages` with a new array even when nothing changed,
  // so the log follows only what is on screen: the newest message, the
  // pending one and the typing/waiting line. It scrolls the log itself, not
  // the page, and leaves it alone while the shopper reads further up.
  const newestMessageId = messages.at(-1)?.id;
  const outgoingText = outgoing?.text;
  const waitingLine = chatStatus(messages, mode, sending, awaitingReply);
  useLayoutEffect(() => {
    if (open) stickToBottom.current = true;
  }, [open]);
  useLayoutEffect(() => {
    // Sending a message always brings the shopper back to the bottom.
    if (outgoingText !== undefined) stickToBottom.current = true;
  }, [outgoingText]);
  useEffect(() => {
    const log = logRef.current;
    if (!open || !log || !stickToBottom.current) return;
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [open, loading, newestMessageId, outgoingText, waitingLine]);
  function onLogScroll() {
    const log = logRef.current;
    if (log) stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  // Opening moves focus into the chat; closing returns it to the opener. The
  // floating button unmounts while the chat is open, so it is the fallback.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        openerRef.current = document.activeElement;
      }
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    // Below sm the bottom bar holds the chat button; above it, the floating one.
    const visible = (element: HTMLElement | null | undefined) => !!element?.isConnected && element.getClientRects().length > 0;
    const fallback = [floatingRef.current, mobileChatRef.current].find(visible);
    (visible(opener) ? opener : fallback)?.focus({ preventScroll: true });
  }, [open]);

  // Below sm the chat covers the whole screen, so the page behind it is taken
  // out of tab order and the accessibility tree while it is open.
  useEffect(() => {
    const main = mainRef.current;
    if (!open || !main) return;
    const fullScreen = window.matchMedia("(max-width: 639.98px)");
    const sync = () => { main.inert = fullScreen.matches; };
    sync();
    fullScreen.addEventListener("change", sync);
    return () => {
      fullScreen.removeEventListener("change", sync);
      main.inert = false;
    };
  }, [open]);

  // The hero has its own chat card; the floating launcher waits until it scrolls away.
  const [heroChatVisible, setHeroChatVisible] = useState(false);
  useEffect(() => {
    const card = document.getElementById("hero-chat");
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => setHeroChatVisible(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(card);
    return () => observer.disconnect();
  }, [catalog, catalogLoading, detailProductId]);

  // A toast left over from "Thêm vào giỏ" would sit on top of the cart's send
  // button on phones, so opening the cart clears it.
  const [cartNotice, setCartNotice] = useState<{ text: string; added: boolean } | null>(null);
  // The cart panel gives focus back to the button that opened it.
  const cartOpenerRef = useRef<HTMLElement | null>(null);
  // Lines the stock check changed (capped or sold out), shown inside the cart.
  const [stockNotice, setStockNotice] = useState("");
  const { reconcile } = cart;
  const checkStock = useCallback((products: ShopProduct[]): boolean => {
    const changes = reconcile((item) => variantStock(products, item));
    if (changes.length) setStockNotice(stockChangeMessage(changes));
    return changes.length === 0;
  }, [reconcile]);
  const openCart = useCallback(() => {
    cartOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCartNotice(null);
    setStockNotice("");
    setCartOpen(true);
    // A basket saved earlier may hold more than the shop has now: check it
    // against the loaded catalog at once, then against fresh stock.
    if (catalog) checkStock(catalog.products);
    if (previewCatalog) return;
    fetch(catalogEndpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const fresh = shopCatalogSchema.parse(await response.json());
        setCatalog(fresh);
        checkStock(fresh.products);
      })
      .catch(() => {
        // The loaded catalog was already checked; the shop confirms stock anyway.
      });
  }, [catalog, catalogEndpoint, checkStock, previewCatalog]);
  const closeCart = useCallback(() => {
    setCartOpen(false);
    const opener = cartOpenerRef.current;
    cartOpenerRef.current = null;
    if (opener?.isConnected) window.setTimeout(() => opener.focus({ preventScroll: true }), 0);
  }, []);

  // "Thêm vào giỏ" on a product card: adds at once when there is one colour
  // and size, otherwise asks for them in a small dialog.
  const [quickAdd, setQuickAdd] = useState<ShopProduct | null>(null);
  const closeQuickAdd = useCallback(() => setQuickAdd(null), []);
  const addToCart = useCallback((item: CartItem, maxQuantity: number) => {
    const added = cart.add(item, maxQuantity);
    const details = [item.color && displayColor(item.color), item.size && `size ${item.size}`].filter(Boolean).join(", ");
    setCartNotice(added
      ? { text: `Đã thêm ${item.name}${details ? ` (${details})` : ""} vào giỏ.`, added: true }
      : { text: "Giỏ đã đủ 10 món. Gửi đơn này trước rồi thêm tiếp nhé.", added: false });
  }, [cart]);
  function quickAddProduct(product: ShopProduct) {
    const choice = onlyChoice(product);
    if (choice) {
      const { stockOf } = productOptions(product);
      addToCart(cartItemFor(product, choice.color, choice.size), stockOf(choice.color, choice.size));
    } else {
      setQuickAdd(product);
    }
  }
  useEffect(() => {
    if (!cartNotice) return;
    const timer = window.setTimeout(() => setCartNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [cartNotice]);

  function askAbout(product: ShopProduct, initialMessage?: string) {
    setSelected(product);
    if (initialMessage) setDraft(initialMessage);
    setOpen(true);
  }

  function sendCart() {
    if (cart.items.length === 0) return;
    // Last check before the order leaves: a change keeps the cart open so the
    // shopper sees the new quantities first.
    if (catalog && !checkStock(catalog.products)) return;
    const message = cartMessage(cart.items);
    cartMessageRef.current = message;
    setSelected(null);
    setDraft(message);
    setCartOpen(false);
    cartOpenerRef.current = null;
    setOpen(true);
  }

  async function addPhoto(file: File) {
    setPhotoError("");
    const prepared = await preparePhoto(file);
    if (!prepared.ok) {
      setPhotoError(prepared.error);
      return;
    }
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { blob: prepared.blob, url: URL.createObjectURL(prepared.blob) };
    });
  }

  function removePhoto() {
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    setPhotoError("");
  }

  async function send(text: string, productId: string | null = selected?.id ?? null) {
    const message = text.trim();
    const attached = photo?.blob ?? null;
    if ((!message && !attached) || sending) return;
    if (previewCatalog) {
      setSendError("Đây là bản xem thử giao diện. Chat thật cần kết nối dữ liệu shop.");
      return;
    }
    setSending(true);
    setSendError("");
    refreshSequence.current += 1;
    const retry = pendingSend.current;
    // A retry of the same text, product and photo reuses the id, so the server dedupes it.
    const clientMessageId = retry?.text === message && retry.productId === productId && retry.photo === attached
      ? retry.clientMessageId
      : crypto.randomUUID();
    pendingSend.current = { text: message, productId, photo: attached, clientMessageId };
    previousReplies.current = new Set(messages.filter((item) => item.sender !== "shopper").map((item) => item.id));
    setOutgoing({ text: message, knownIds: new Set(messages.map((item) => item.id)) });
    setDraft("");
    let responseError = "";
    try {
      let response: Response;
      if (attached) {
        const form = new FormData();
        form.set("text", message);
        if (productId) form.set("productId", productId);
        form.set("clientMessageId", clientMessageId);
        form.set("photo", attached, attached.type === "image/png" ? "photo.png" : attached.type === "image/webp" ? "photo.webp" : "photo.jpg");
        response = await fetch(endpoint, { method: "POST", body: form });
      } else {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message, productId, clientMessageId }),
        });
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        responseError = typeof data?.error === "string" && data.error !== "Failed to fetch"
          ? data.error
          : "Không gửi được tin nhắn. Vui lòng thử lại.";
        throw new Error("send_failed");
      }
      pendingSend.current = null;
      if (cartMessageRef.current === message) {
        cartMessageRef.current = null;
        cart.clear();
      }
      if (attached) removePhoto();
      // Only an `ai` conversation answers; with staff the poll shows the wait.
      if (mode === "ai") setAwaitingReply(true);
      await refresh();
    } catch {
      setAwaitingReply(false);
      // Hand the text back so "Gửi" retries it with the same clientMessageId.
      setDraft((current) => current || message);
      setSendError(responseError || "Chưa gửi được tin nhắn. Vui lòng kiểm tra kết nối và thử lại.");
      await refresh();
    } finally {
      setOutgoing(null);
      setSending(false);
      // Tapping Gửi or a suggestion moved focus off the field; put it back so
      // the next message can be typed straight away.
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  // Page-level questions are general, so they drop any product context.
  function askText(text: string) {
    setSelected(null);
    if (open && !loading && !sending) {
      void send(text, null);
      return;
    }
    queuedAsk.current = text;
    setOpen(true);
  }

  // Waiting for the history keeps the "new reply" check in send() accurate.
  useEffect(() => {
    const text = queuedAsk.current;
    if (!open || loading || sending || text === null) return;
    queuedAsk.current = null;
    void send(text, null);
    // send() is recreated every render; open/loading/sending gate the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, sending]);

  const lastReply = messages.at(-1)?.reply;
  // Hidden once a poll brings back the stored copy of the same message.
  const showOutgoing = outgoing !== null && !messages.some((message) =>
    message.sender === "shopper" && message.text === outgoing.text && !outgoing.knownIds.has(message.id));
  const status = waitingLine;
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
  const shopHref = previewCatalog ? "/dev/shop" : `/s/${encodeURIComponent(slug)}`;
  const senderLabel = { shopper: "Bạn", ai: "Trợ lý AI", staff: "Nhân viên", system: "Shop" } as const;
  const detailProduct = detailProductId ? products.find((product) => product.id === detailProductId) : null;
  const policies = catalog.shop.policies;
  const policyItems = [
    { title: "Đổi trả", text: policies?.returns ?? "" },
    { title: "Giao hàng", text: policies?.shipping ?? "" },
  ].filter((item) => item.text);
  const itemCount = cartCount(cart.items);
  const grouped = products.map((product, index) => ({ product, index, group: productGroup(product.category, product.name) }));
  const groupCounts = new Map<ProductGroup, number>();
  for (const item of grouped) groupCounts.set(item.group, (groupCounts.get(item.group) ?? 0) + 1);
  const groupChips = ([...PRODUCT_GROUPS, OTHER_GROUP] as ProductGroup[]).filter((name) => groupCounts.has(name));
  const allSizes = [...new Set(products.flatMap((product) => product.sizesInStock))].sort(compareSizes);
  const { group, size: sizeFilter, sort } = readShopFilters(searchParams, { groups: groupChips, sizes: allSizes });
  const filtered = grouped
    .filter((item) => !group || item.group === group)
    .filter((item) => !sizeFilter || item.product.sizesInStock.includes(sizeFilter))
    .filter((item) => matchesQuery([item.product.name, item.product.category, item.group, ...item.product.colors], search))
    .sort((a, b) => {
      if (sort === "price-asc") return a.product.price - b.product.price || a.index - b.index;
      if (sort === "price-desc") return b.product.price - a.product.price || a.index - b.index;
      return groupRank(a.group) - groupRank(b.group) || a.index - b.index;
    })
    .map((item) => item.product);
  // A description/photo search shows its ranked products instead (AC1, AC3);
  // ids the catalog no longer has are dropped.
  const semantic = searchState.status === "done" ? searchState : null;
  const listed = semantic
    ? semantic.productIds.flatMap((id) => products.find((product) => product.id === id) ?? [])
    : filtered;
  // Any filter change starts the list again from the first page.
  const filterKey = [group, sizeFilter, sort, search, semantic?.seq ?? ""].join("|");
  const shown = more.key === filterKey ? more.count : PAGE_SIZE;
  const visibleProducts = listed.slice(0, shown);
  const filtering = group !== "" || sizeFilter !== "" || search.trim() !== "";
  // A choice adds a history entry (back undoes it); typing in the search box replaces it.
  function setFilters(change: Partial<ShopFilters>, history: "push" | "replace" = "push") {
    const next = { group, size: sizeFilter, sort, search, ...change };
    const { pathname, search: query, hash } = window.location;
    const url = `${pathname}${shopFilterQuery(next, new URLSearchParams(query))}${hash}`;
    // Choosing the filter already shown adds no history entry.
    if (url !== `${pathname}${query}${hash}`) window.history[history === "push" ? "pushState" : "replaceState"](null, "", url);
    if (change.search !== undefined) setSearch(change.search);
  }
  const clearFilters = () => {
    endSearch(true);
    setFilters({ group: "", size: "", search: "" });
  };

  // PB-34: Enter, the search button, or a new photo runs the description search.
  async function runSearch(text: string, photo: Blob | null) {
    const trimmed = text.trim();
    if (!photo && !trimmed) return;
    if (!photo && trimmed.length < SEARCH_MIN_TEXT) {
      setSearchState({ status: "error", message: searchErrors.tooShort });
      return;
    }
    const seq = ++searchSeq.current;
    setSearchState({ status: "loading", seq, label: searchLabel(trimmed, photo !== null) });
    // Group, size and sort don't apply to search results (A2).
    setFilters({ group: "", size: "", sort: "group" });
    const form = new FormData();
    form.set("q", trimmed);
    if (photo) form.set("photo", photo, "photo");
    let result: SearchResult;
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(slug)}/search`, { method: "POST", body: form });
      const json: unknown = await response.json().catch(() => null);
      const parsed = searchResponseSchema.safeParse(json);
      if (response.ok && parsed.success) result = { ok: true, body: parsed.data, hasPhoto: photo !== null };
      else {
        const error = json && typeof json === "object" && "error" in json && typeof json.error === "string" ? json.error : searchErrors.failed;
        result = { ok: false, message: error };
      }
    } catch {
      result = { ok: false, message: searchErrors.failed };
    }
    setSearchState((current) => applyResult(current, seq, result));
  }
  async function pickSearchPhoto(file: File) {
    const pick = ++photoSeq.current;
    const prepared = await preparePhoto(file);
    // A newer photo, "Xóa ảnh" or leaving the search came first: drop this one.
    if (pick !== photoSeq.current) return;
    if (!prepared.ok) {
      searchSeq.current += 1;
      setSearchState({ status: "error", message: prepared.error });
      return;
    }
    setSearchPhoto(prepared.blob);
    void runSearch(searchTextRef.current, prepared.blob);
  }
  const removeSearchPhoto = () => endSearch(true);
  // "Xóa tìm kiếm": the full list again, with no text and no photo.
  function clearSearch() {
    endSearch(true);
    setFilters({ search: "" }, "replace");
  }
  // Empty search results: open the chat with the typed text as a draft (AC3).
  function askWithDraft(text: string) {
    setSelected(null);
    setDraft(text);
    setOpen(true);
  }
  const groupLinks: GroupLink[] = groupChips.map((name) => ({
    name,
    count: groupCounts.get(name) ?? 0,
    imageUrl: grouped.find((item) => item.group === name && item.product.imageUrl)?.product.imageUrl ?? null,
  }));
  // Menus, tiles and the footer pick a group and bring the grid into view.
  function showGroup(name: string) {
    endSearch(true);
    setFilters({ group: name as ProductGroup, search: "" });
    document.getElementById("san-pham")?.scrollIntoView({ block: "start" });
  }
  // The header search shows all its matches in the grid, across every group.
  function searchProducts(query: string) {
    endSearch(true);
    setFilters({ group: "", size: "", search: query });
    document.getElementById("san-pham")?.scrollIntoView({ block: "start" });
  }
  const inStock = products.filter((product) => product.sizesInStock.length > 0);
  const featured = (inStock.length >= 3 ? inStock : products).slice(0, 3);
  const sizeChart = products.find((product) => product.sizeChart && product.sizeChart.length > 0)?.sizeChart ?? null;
  const marqueeItems = [
    "Trợ lý AI trả lời ngay trên trang",
    ...policyItems.map((item) => `${item.title}: ${firstSentence(item.text)}`),
    "Nhân viên shop hỗ trợ khi cần",
  ];
  const groupTabs = [{ name: "" as const, label: "Tất cả", count: products.length }, ...groupLinks.map((item) => ({ name: item.name as ProductGroup, label: item.name, count: item.count }))];
  const cartPanel = cartOpen && (
    <CartPanel
      items={cart.items}
      shippingPolicy={policies?.shipping || undefined}
      stockNotice={stockNotice}
      onQuantity={cart.setQuantity}
      onRemove={cart.remove}
      onRestore={cart.restore}
      onSend={sendCart}
      onClose={closeCart}
    />
  );

  return (
    <>
      <main ref={mainRef} className={`flex-1 ${detailProductId ? "" : "shop-has-bar"}`}>
        {detailProductId ? detailProduct ? (
          <ProductDetailView
            key={detailProduct.id}
            shopName={shopName}
            product={detailProduct}
            shopHref={shopHref}
            policies={policies}
            cartCount={itemCount}
            onAsk={askAbout}
            onAddToCart={cart.add}
            onOpenCart={openCart}
          />
        ) : (
          <section className="mx-auto max-w-4xl px-4 py-24 text-center">
            <EmptyState title="Không tìm thấy sản phẩm" description="Sản phẩm này không còn trong cửa hàng." />
            <Link href={shopHref} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#171717] px-5 text-sm font-semibold text-white">Về cửa hàng</Link>
          </section>
        ) : <>
        <ShopMarquee items={marqueeItems} />
        <ShopHeader
          shopName={shopName}
          groups={groupLinks}
          itemCount={itemCount}
          onOpenCart={openCart}
          onAsk={askText}
          onChooseGroup={showGroup}
          products={products}
          productHref={(productId) => `${shopHref}/p/${encodeURIComponent(productId)}`}
          search={search}
          onSearch={searchProducts}
        />
        <ShopHero shopName={shopName} bannerUrl={catalog.shop.bannerUrl} featured={featured} onAsk={askText} onAskAbout={(product) => askAbout(product)} />

        <section id="san-pham" aria-labelledby="san-pham-title" className="mx-auto max-w-[1400px] scroll-mt-24 px-4 py-14 sm:px-6 sm:py-20 lg:px-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <h2 id="san-pham-title" className="text-[clamp(1.9rem,3.6vw,3rem)] font-black uppercase leading-none tracking-[-.04em]">Khám phá sản phẩm<span className="text-[#e9573f]">.</span></h2>
            <p className="text-sm font-semibold tabular-nums text-[#706d67]">{listed.length} / {products.length} sản phẩm</p>
          </div>
          {products.length > 0 && (
            <div className="mb-7">
              {groupTabs.length > 2 && (
                <div role="group" aria-label="Nhóm sản phẩm" className="-mx-4 flex gap-6 overflow-x-auto border-b border-[#e3dfd8] px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
                  {groupTabs.map((tab) => (
                    <button key={tab.label} type="button" aria-pressed={group === tab.name} onClick={() => { endSearch(false); setFilters({ group: tab.name }); }} className={`-mb-px inline-flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 text-xs font-extrabold uppercase tracking-[.12em] transition-colors ${group === tab.name ? "border-[#171717] text-[#171717]" : "border-transparent text-[#706d67] hover:text-[#171717]"}`}>
                      {tab.label} <span className="font-semibold tabular-nums tracking-normal">{tab.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <SmartSearch
                  value={search}
                  onChange={(value) => {
                    // Typing goes back to the instant filter and drops a pending
                    // answer (AC1); the photo stays for the next Enter.
                    if (searchState.status !== "idle") endSearch(false);
                    setFilters({ search: value }, "replace");
                  }}
                  onSubmit={() => void runSearch(search, searchPhoto)}
                  photo={searchPhoto}
                  onPhoto={(file) => void pickSearchPhoto(file)}
                  onRemovePhoto={removeSearchPhoto}
                  busy={searchState.status === "loading"}
                  error={searchState.status === "error" ? searchState.message : ""}
                />
                <div className="flex flex-wrap gap-3">
                  {allSizes.length > 0 && <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em]">Size <select value={sizeFilter} onChange={(event) => { endSearch(false); setFilters({ size: event.target.value }); }} className="min-h-11 border border-[#8f8a82] bg-white px-3 text-sm font-medium normal-case tracking-normal"><option value="">Tất cả</option>{allSizes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
                  <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em]">Sắp xếp <select value={sort} onChange={(event) => { endSearch(false); setFilters({ sort: event.target.value as ShopSort }); }} className="min-h-11 border border-[#8f8a82] bg-white px-3 text-sm font-medium normal-case tracking-normal"><option value="group">Theo nhóm</option><option value="price-asc">Giá thấp đến cao</option><option value="price-desc">Giá cao đến thấp</option></select></label>
                </div>
              </div>
            </div>
          )}
          {semantic && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="min-w-0 text-lg font-black [overflow-wrap:anywhere]">{semantic.label}</h3>
              <button type="button" onClick={clearSearch} className="inline-flex min-h-11 items-center border-[1.5px] border-[#171717] px-5 text-xs font-extrabold uppercase tracking-[.12em] hover:bg-white">Xóa tìm kiếm</button>
            </div>
          )}
          {products.length === 0 ? <EmptyState title="Chưa có sản phẩm" description="Vui lòng quay lại sau." /> : semantic && listed.length === 0 ? (
            <div className="py-6 text-center">
              <EmptyState title="Không tìm thấy sản phẩm" description="Thử bỏ bớt bộ lọc, hoặc hỏi trợ lý AI tìm giúp." />
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={() => askWithDraft(search.trim())} className="inline-flex min-h-11 items-center bg-[#171717] px-5 text-xs font-extrabold uppercase tracking-[.12em] text-white hover:bg-[#c2412b]">Hỏi trợ lý AI</button>
              </div>
            </div>
          ) : listed.length === 0 ? (
            <div className="py-6 text-center">
              <EmptyState title="Không tìm thấy sản phẩm" description="Thử bỏ bớt bộ lọc, hoặc hỏi trợ lý AI tìm giúp." />
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {filtering && <button type="button" onClick={clearFilters} className="inline-flex min-h-11 items-center border-[1.5px] border-[#171717] px-5 text-xs font-extrabold uppercase tracking-[.12em] hover:bg-white">Xóa bộ lọc</button>}
                <button type="button" onClick={() => { if (search.trim()) askWithDraft(search.trim()); else setOpen(true); }} className="inline-flex min-h-11 items-center bg-[#171717] px-5 text-xs font-extrabold uppercase tracking-[.12em] text-white hover:bg-[#c2412b]">Hỏi trợ lý AI</button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    href={`${shopHref}/p/${encodeURIComponent(product.id)}`}
                    name={product.name}
                    price={product.price}
                    imageUrl={product.imageUrl}
                    colors={product.colors}
                    sizesInStock={product.sizesInStock}
                    action={(
                      <div className="flex gap-2">
                        <button type="button" onClick={() => askAbout(product)} aria-label={`Hỏi về mẫu này: ${product.name}`} className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap border border-[#171717] px-2 text-[11px] font-extrabold uppercase tracking-[.04em] sm:tracking-[.1em] transition-colors hover:bg-[#171717] hover:text-white">
                          <span className="sm:hidden">Hỏi shop</span><span className="hidden sm:inline">Hỏi về mẫu này</span>
                        </button>
                        {product.sizesInStock.length > 0 && (
                          <button type="button" onClick={() => quickAddProduct(product)} aria-label={`Thêm vào giỏ: ${product.name}`} title="Thêm vào giỏ" className="inline-grid size-10 shrink-0 place-items-center bg-[#e9573f] text-[#171717] transition-colors hover:bg-[#171717] hover:text-white">
                            <Icon name="cart" className="size-5" />
                          </button>
                        )}
                      </div>
                    )}
                  />
                ))}
              </div>
              {listed.length > visibleProducts.length && (
                <div className="mt-10 flex flex-col items-center gap-2">
                  <button type="button" onClick={() => setMore({ key: filterKey, count: shown + PAGE_SIZE })} className="inline-flex min-h-12 items-center border-[1.5px] border-[#171717] px-6 text-xs font-extrabold uppercase tracking-[.12em] transition-colors hover:bg-[#171717] hover:text-white">Xem thêm</button>
                  <p className="text-xs tabular-nums text-[#706d67]">Đang xem {visibleProducts.length} / {listed.length}</p>
                </div>
              )}
            </>
          )}
        </section>

        {groupLinks.length > 1 && <GroupTiles groups={groupLinks} onChoose={showGroup} onAsk={askText} />}
        <SizeBand chart={sizeChart} onAsk={askText} />
        <ShopFooter shopName={shopName} contact={catalog.shop.contact} groups={groupLinks} policyItems={policyItems} onChoose={showGroup} onAsk={askText} />
        </>}
      </main>

      {!detailProductId && (
        <div className="shop-bar fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-2 border-t border-[#e3dfd8] bg-white/95 p-3 backdrop-blur-xl sm:hidden">
          <button ref={mobileChatRef} type="button" onClick={() => setOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap bg-[#171717] px-3 text-xs font-extrabold uppercase tracking-[.06em] text-white"><span aria-hidden="true" className="size-[7px] rounded-full bg-[#4cc47a]" />Chat với shop</button>
          <button type="button" onClick={openCart} aria-label={`Giỏ đặt hàng, ${itemCount} món`} className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap border-[1.5px] border-[#171717] px-3 text-sm font-extrabold tabular-nums"><Icon name="cart" className="size-5" />{itemCount}</button>
        </div>
      )}

      {!open && !detailProductId && !heroChatVisible && (
        <div className="ui-chat-enter fixed bottom-6 right-6 z-40 hidden sm:block">
          <button ref={floatingRef} type="button" onClick={() => setOpen(true)} className="group flex min-h-14 items-center gap-3 rounded-full bg-[#171717] py-1.5 pl-1.5 pr-5 text-sm font-bold text-white shadow-[0_16px_35px_-12px_#171717aa] transition-colors hover:bg-[#c2412b]">
            <span className="relative shrink-0">
              <Image src="/images/shop-avatar.jpg" alt="" width={44} height={44} className="size-11 rounded-full object-cover" />
              <span aria-hidden="true" className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-[#171717] bg-[#4cc47a] group-hover:border-[#c2412b]" />
            </span>
            Chat với shop
          </button>
        </div>
      )}

      {cartPanel}
      {quickAdd && <QuickAdd product={quickAdd} onAdd={(item, maxQuantity) => { setQuickAdd(null); addToCart(item, maxQuantity); }} onClose={closeQuickAdd} />}
      {cartNotice && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-sm items-center gap-3 bg-[#171717] py-2 pl-4 pr-2 text-sm text-white shadow-[0_16px_35px_-12px_#171717aa] sm:bottom-6">
          <p className="min-w-0 flex-1">{cartNotice.text}</p>
          {cartNotice.added && <button type="button" onClick={() => { setCartNotice(null); openCart(); }} className="min-h-10 shrink-0 bg-[#e9573f] px-3 text-[11px] font-extrabold uppercase tracking-[.1em] text-[#171717] hover:bg-white">Xem giỏ</button>}
        </div>
      )}

      {open && (
        <section role="dialog" aria-label="Trò chuyện với shop" className="ui-drawer fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-white shadow-[-24px_0_60px_-30px_#17171780] sm:left-auto sm:w-[440px] sm:border-l sm:border-[#171717]">
          <header className="flex items-center gap-3 bg-[#171717] px-4 py-4 text-white">
            <Image src="/images/shop-avatar.jpg" alt="" width={40} height={40} className="size-10 shrink-0 object-cover" />
            <div className="min-w-0 flex-1"><h2 className="truncate font-bold">{shopName}</h2><p className="text-xs text-[#bbb8b2]">Trợ lý AI trả lời ngay · nhân viên hỗ trợ khi cần</p></div>
            <button type="button" className="inline-grid size-11 shrink-0 place-items-center border border-[#ffffff66] transition-colors hover:bg-white hover:text-[#171717]" onClick={() => setOpen(false)} aria-label="Đóng trò chuyện"><Icon name="close" className="size-4" /></button>
          </header>

          {selected && (
            <div className="flex items-center justify-between gap-2 border-b border-[#e3dfd8] bg-[#efebe4] px-4 py-2 text-sm">
              <span className="min-w-0 truncate">Đang hỏi về: <strong>{selected.name}</strong></span>
              <button type="button" className="min-h-11 shrink-0 px-2 underline" onClick={() => setSelected(null)}>
                Bỏ chọn
              </button>
            </div>
          )}

          {/* No aria-live here: it would read the whole history again on every
              poll. The single role="status" below announces the wait. */}
          <div ref={logRef} onScroll={onLogScroll} className="min-h-0 flex-1 overflow-y-auto bg-[#f5f3ef] px-4 py-5">
            {loading ? (
              <LoadingRegion label="Đang tải cuộc trò chuyện…"><ChatSkeleton /></LoadingRegion>
            ) : messages.length === 0 && !showOutgoing ? (
              <div className="space-y-5"><div className="ui-card overflow-hidden"><Image src="/images/chat-welcome.jpg" alt="" width={840} height={360} sizes="(max-width: 640px) 100vw, 420px" className="aspect-[7/3] w-full object-cover" /><div className="p-5"><h3 className="text-lg font-bold">Xin chào! Mình giúp gì cho bạn?</h3><p className="mt-2 text-sm leading-6 text-[#706d67]">Hỏi về sản phẩm, size, màu sắc hoặc một set đồ hợp với bạn.</p></div></div><div><p className="mb-3 text-xs font-semibold text-[#706d67]">Gợi ý câu hỏi</p><div className="flex flex-wrap gap-2">{["Shop còn size M không?", "Tư vấn size giúp mình", "Gợi ý phối đồ"].map((text) => <button key={text} type="button" onClick={() => void send(text)} disabled={sending || loading} className="inline-flex min-h-11 items-center rounded-full border border-[#8f8a82] bg-white px-4 text-sm font-semibold transition-colors hover:border-[#171717] disabled:opacity-50">{text}</button>)}</div></div></div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div key={message.id} className={message.sender === "shopper" ? "ml-8" : "mr-8"}>
                    <p className="mb-1 text-xs text-[#706d67]">
                      {senderLabel[message.sender]}
                      {status === "waiting_staff" && index === messages.length - 1 && " · Đã gửi"}
                    </p>
                    {message.photoUrls.length > 0 && (
                      <div className="mb-1 flex flex-wrap justify-end gap-1">
                        {message.photoUrls.map((url, i) => url ? (
                          // Signed Supabase URLs expire after an hour: next/image would cache them.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={url} alt="Ảnh bạn gửi" className="max-h-60 max-w-[240px] rounded-xl object-cover" />
                        ) : (
                          <p key={i} className="text-xs text-[#706d67]">Không tải được ảnh.</p>
                        ))}
                      </div>
                    )}
                    {(message.reply?.text || message.text) && (
                      <div className={`break-words rounded-xl p-3 text-sm leading-6 ${message.sender === "shopper" ? "rounded-br-sm bg-[#171717] text-white" : "rounded-bl-sm border border-[#e3dfd8] bg-white text-[#171717]"}`}>
                        {message.reply?.text || message.text}
                      </div>
                    )}
                    {message.reply && message.reply.products.length > 0 && (
                      <div className="mt-2 grid gap-2">
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
                {showOutgoing && outgoing && (
                  <div className="ml-8">
                    <p className="mb-1 text-xs text-[#706d67]">{senderLabel.shopper} · Đang gửi…</p>
                    <div className="break-words rounded-xl rounded-br-sm bg-[#171717] p-3 text-sm leading-6 text-white opacity-80">{outgoing.text}</div>
                  </div>
                )}
              </div>
            )}
            {status === "typing" && (
              <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-xl rounded-bl-sm border border-[#e3dfd8] bg-white px-3 py-2 text-sm text-[#706d67]">
                <TypingDots /> Shop đang trả lời…
              </p>
            )}
            {status === "waiting_staff" && (
              <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-xl rounded-bl-sm border border-[#e3dfd8] bg-white px-3 py-2 text-sm text-[#706d67]">
                <span className="sr-only">Đã gửi. </span>Đang chờ nhân viên shop trả lời
              </p>
            )}
          </div>

          <div className="border-t border-[#e3dfd8] bg-white p-3">
            {previewCatalog && <p className="mb-2 text-xs text-[#706d67]">Bản xem thử giao diện — chưa kết nối chat.</p>}
            {lastReply && lastReply.quickReplies.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {lastReply.quickReplies.map((text) => (
                  <Button key={text} variant="secondary" className="min-h-11 max-w-full whitespace-normal break-words text-left text-sm" disabled={sending} onClick={() => void send(text)}>
                    {text}
                  </Button>
                ))}
              </div>
            )}
            {error && <ErrorMessage className="mb-2">{error}</ErrorMessage>}
            {sendError && <ErrorMessage className="mb-2">{sendError}</ErrorMessage>}
            {photoError && <ErrorMessage className="mb-2">{photoError}</ErrorMessage>}
            {photo && (
              <div className="mb-2 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */}
                <img src={photo.url} alt="Ảnh sắp gửi" className="size-16 rounded-lg object-cover" />
                <button type="button" aria-label="Xóa ảnh" onClick={removePhoto} disabled={sending} className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[#8f8a82] hover:border-[#171717] disabled:opacity-50">
                  <Icon name="close" width={16} height={16} />
                </button>
              </div>
            )}
            <form onSubmit={submit} className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void addPhoto(file);
                }}
              />
              <button type="button" aria-label="Gửi ảnh" onClick={() => fileRef.current?.click()} disabled={sending || loading} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-[#8f8a82] hover:border-[#171717] disabled:opacity-50">
                <Icon name="image" />
              </button>
              {/* readOnly, not disabled, while sending: a disabled field drops
                  focus and closes the phone keyboard after every message. */}
              <input
                ref={inputRef}
                aria-label="Tin nhắn"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const item = [...event.clipboardData.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
                  const file = item?.getAsFile();
                  if (file) {
                    event.preventDefault();
                    void addPhoto(file);
                  }
                }}
                maxLength={1000}
                className="ui-field min-h-11 min-w-0 flex-1 px-3 text-base"
                placeholder="Nhập câu hỏi của bạn"
                readOnly={sending || loading}
              />
              <Button type="submit" aria-label="Gửi" title="Gửi" className="w-11 shrink-0 px-0!" disabled={loading || (!draft.trim() && !photo)} loading={sending}>{!sending && <Icon name="send" className="size-5 shrink-0" />}</Button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
