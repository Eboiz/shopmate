"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPrice } from "@/lib/format";
import { displayColor } from "@/lib/shop/catalog-view";
import { CART_MAX_LINES, cartLineKey, cartLineMax, cartSubtotal, type CartItem } from "./cart";
import { useModal } from "./use-modal";

export type CheckoutCustomer = { name: string; phone: string; address: string };
export type CheckoutResult = { ok: true; total: number } | { ok: false; message: string };
type CustomerErrors = Partial<Record<keyof CheckoutCustomer, string>>;

// The details typed last time, kept in this browser so a returning shopper
// doesn't type them again. Storage can be blocked: then the form starts empty.
const CUSTOMER_KEY = "shopmate:checkout-customer";
function savedCustomer(): CheckoutCustomer {
  try {
    const value = JSON.parse(window.localStorage.getItem(CUSTOMER_KEY) ?? "null") as Partial<CheckoutCustomer> | null;
    return { name: value?.name ?? "", phone: value?.phone ?? "", address: value?.address ?? "" };
  } catch {
    return { name: "", phone: "", address: "" };
  }
}
function saveCustomer(customer: CheckoutCustomer) {
  try {
    window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  } catch {
    // Not remembered; the order itself is unaffected.
  }
}

// Checked here for a quick answer; the server checks the same rules again.
export function customerErrors(customer: CheckoutCustomer): CustomerErrors {
  const phone = customer.phone.replace(/[\s.\-()]/g, "").replace(/^\+84/, "0");
  const errors: CustomerErrors = {};
  if (!customer.name.trim()) errors.name = "Vui lòng nhập họ tên.";
  if (!/^0\d{9}$/.test(phone)) errors.phone = "Số điện thoại gồm 10 số, bắt đầu bằng 0.";
  if (!customer.address.trim()) errors.address = "Vui lòng nhập địa chỉ giao hàng.";
  return errors;
}

type Props = {
  items: CartItem[];
  shippingPolicy?: string;
  // What the stock check changed in the basket, if anything.
  stockNotice?: string;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onRestore: (item: CartItem, index: number) => boolean;
  onSend: () => void;
  // Checkout without the AI: the order goes straight to the shop's order list.
  onCheckout: (customer: CheckoutCustomer) => Promise<CheckoutResult>;
  onOpenChat: () => void;
  onClose: () => void;
};

export function CartPanel({ items, shippingPolicy, stockNotice, onQuantity, onRemove, onRestore, onSend, onCheckout, onOpenChat, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const subtotal = cartSubtotal(items);
  useModal(panelRef);

  // "cart" lists the lines; "checkout" asks where to deliver; "done" thanks the
  // shopper once the order is in (the basket is empty by then).
  const [step, setStep] = useState<"cart" | "checkout" | "done">("cart");
  const [customer, setCustomer] = useState<CheckoutCustomer>(savedCustomer);
  const [fieldErrors, setFieldErrors] = useState<CustomerErrors>({});
  const [checkoutError, setCheckoutError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placedTotal, setPlacedTotal] = useState(0);

  async function submitCheckout(event: FormEvent) {
    event.preventDefault();
    if (placing) return;
    const errors = customerErrors(customer);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPlacing(true);
    setCheckoutError("");
    const result = await onCheckout(customer);
    setPlacing(false);
    if (result.ok) {
      saveCustomer(customer);
      setPlacedTotal(result.total);
      setStep("done");
    } else {
      setCheckoutError(result.message);
    }
  }

  // The last line taken out, kept until the next removal or until the panel
  // closes, so "Hoàn tác" never races a timer.
  const [removed, setRemoved] = useState<{ item: CartItem; index: number } | null>(null);
  // The line whose trash button takes focus once "Hoàn tác" has put it back.
  // Cleared as soon as it is used, so later quantity changes leave focus alone.
  const restoredKeyRef = useRef<string | null>(null);
  const showUndo = removed !== null && !items.some((line) => cartLineKey(line) === cartLineKey(removed.item));

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  // The trash button disappears with its line: hand focus to "Hoàn tác".
  useEffect(() => {
    if (removed) undoRef.current?.focus({ preventScroll: true });
  }, [removed]);
  useEffect(() => {
    const key = restoredKeyRef.current;
    if (!key) return;
    const trash = panelRef.current?.querySelector<HTMLElement>(`[data-line="${CSS.escape(key)}"] button[data-remove]`);
    if (!trash) return;
    restoredKeyRef.current = null;
    trash.focus({ preventScroll: true });
  }, [items]);

  function remove(item: CartItem, index: number) {
    restoredKeyRef.current = null;
    setRemoved({ item, index });
    onRemove(cartLineKey(item));
  }

  function undo() {
    if (!removed) return;
    if (onRestore(removed.item, removed.index)) restoredKeyRef.current = cartLineKey(removed.item);
    setRemoved(null);
  }

  const undoRow = showUndo && (
    <li key="undo" role="status" className="flex items-center justify-between gap-3 border-b border-[#e3dfd8] py-3 text-sm">
      <span className="min-w-0 text-[#4a4741]">Đã bỏ <span className="font-semibold text-[#171717]">{removed.item.name}</span> khỏi giỏ.</span>
      <button ref={undoRef} type="button" onClick={undo} className="min-h-11 shrink-0 px-2 text-xs font-extrabold uppercase tracking-[.1em] text-[#a83826] underline-offset-4 hover:underline">Hoàn tác</button>
    </li>
  );

  const rows = items.map((item, index) => {
    const key = cartLineKey(item);
    const max = cartLineMax(item);
    const atMax = item.quantity >= max;
    return (
      <li key={key} data-line={key} className="grid grid-cols-[64px_1fr] gap-3 border-b border-[#e3dfd8] py-4">
        <div className="relative h-20 w-16 overflow-hidden rounded-md bg-[#eeebe5]">
          <Image src={item.imageUrl ?? "/images/product-placeholder.jpg"} alt="" fill sizes="64px" className="object-cover" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{item.name}</p>
          <p className="mt-0.5 text-xs text-[#706d67]">{[item.color && displayColor(item.color), item.size && `Size ${item.size}`].filter(Boolean).join(" · ")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center overflow-hidden rounded-lg border border-[#8f8a82]">
              <button type="button" aria-label={`Giảm số lượng ${item.name}`} disabled={item.quantity <= 1} onClick={() => onQuantity(key, item.quantity - 1)} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">−</button>
              <output aria-label={`Số lượng ${item.name}`} className="min-w-8 text-center text-sm font-semibold tabular-nums">{item.quantity}</output>
              {/* aria-disabled, not disabled: the button keeps keyboard focus at the
                  limit and points to the notice below instead of dropping focus. */}
              <button type="button" aria-label={`Tăng số lượng ${item.name}`} aria-disabled={atMax} aria-describedby={atMax ? `max-${index}` : undefined} onClick={() => { if (!atMax) onQuantity(key, item.quantity + 1); }} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] aria-disabled:cursor-not-allowed aria-disabled:opacity-40">+</button>
            </div>
            <span className="text-sm font-bold tabular-nums">{formatPrice(item.price * item.quantity)}</span>
            <button type="button" data-remove onClick={() => remove(item, index)} aria-label={`Bỏ ${item.name} khỏi giỏ`} title="Bỏ khỏi giỏ" className="ml-auto inline-grid size-11 place-items-center rounded-lg text-[#706d67] transition-colors hover:bg-[#fff0eb] hover:text-[#b2382a]"><Icon name="trash" className="size-5" /></button>
          </div>
          <p id={`max-${index}`} role="status" className="mt-1.5 text-xs text-[#706d67] empty:hidden">{atMax ? (max < 99 ? `Tối đa ${max}: shop chỉ còn ${max} sản phẩm này.` : `Tối đa ${max} sản phẩm mỗi món.`) : ""}</p>
        </div>
      </li>
    );
  });
  if (undoRow) rows.splice(Math.min(removed.index, rows.length), 0, undoRow);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default bg-[#17171766]" onClick={onClose} />
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="gio-dat-title" className="ui-chat-enter relative flex h-dvh w-full flex-col bg-white shadow-2xl sm:w-[420px]">
        <header className="flex items-center justify-between gap-3 border-b border-[#e3dfd8] px-5 py-4">
          <div className="flex items-center gap-1">
            {step === "checkout" && (
              <button type="button" onClick={() => setStep("cart")} aria-label="Quay lại giỏ" className="-ml-2 inline-grid size-11 place-items-center rounded-lg hover:bg-[#f5f3ef]"><Icon name="chevron" className="size-5 rotate-90" /></button>
            )}
            <h2 id="gio-dat-title" className="text-lg font-bold">{step === "checkout" ? "Thông tin giao hàng" : step === "done" ? "Đã gửi đơn" : "Giỏ đặt hàng"}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng giỏ" className="-mr-2 inline-grid size-11 place-items-center rounded-lg hover:bg-[#f5f3ef]"><Icon name="close" className="size-5" /></button>
        </header>

        {step === "done" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
            <div role="status" className="space-y-3">
              <span className="inline-grid size-12 place-items-center rounded-full bg-[#eef4ea] text-[#2f6b3a]"><Icon name="check" className="size-6" /></span>
              <p className="text-lg font-bold">Shop đã nhận đơn của bạn</p>
              <p className="text-sm leading-6 text-[#4a4741]">Tổng tiền hàng {formatPrice(placedTotal)} (chưa gồm phí giao hàng). Shop sẽ kiểm tra tồn kho và nhắn xác nhận trong khung chat.</p>
            </div>
            <div className="mt-6 grid gap-2">
              <button type="button" onClick={onOpenChat} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#c2412b] px-5 text-sm font-semibold text-white hover:bg-[#a83826]">Xem đơn trong chat</button>
              <button type="button" onClick={onClose} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#8f8a82] px-5 text-sm font-semibold hover:border-[#171717]">Tiếp tục mua sắm</button>
            </div>
          </div>
        )}

        {step === "checkout" && (
          <form onSubmit={submitCheckout} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <CheckoutField label="Họ tên" autoComplete="name" maxLength={100} value={customer.name} error={fieldErrors.name}
                onChange={(name) => setCustomer({ ...customer, name })} />
              <CheckoutField label="Số điện thoại" type="tel" inputMode="tel" autoComplete="tel" value={customer.phone} error={fieldErrors.phone}
                onChange={(phone) => setCustomer({ ...customer, phone })} />
              <CheckoutField label="Địa chỉ giao hàng" autoComplete="street-address" maxLength={300} value={customer.address} error={fieldErrors.address}
                onChange={(address) => setCustomer({ ...customer, address })} />
              <div className="border-t border-[#e3dfd8] pt-3 text-sm">
                <p className="font-semibold">{items.length} món · {items.reduce((sum, item) => sum + item.quantity, 0)} sản phẩm</p>
                <p className="mt-1 text-xs leading-5 text-[#706d67]">Thanh toán khi nhận hàng. Shop kiểm tra tồn kho, báo phí giao hàng và xác nhận đơn trong chat.</p>
              </div>
              {checkoutError && <p role="alert" className="bg-[#fff0eb] px-3 py-2 text-sm font-semibold leading-5 text-[#a83826]">{checkoutError}</p>}
            </div>
            <footer className="border-t border-[#e3dfd8] px-5 py-4">
              <p className="flex justify-between text-base font-bold"><span>Tạm tính</span><span className="tabular-nums">{formatPrice(subtotal)}</span></p>
              <button type="submit" disabled={placing || items.length === 0} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#c2412b] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#a83826] disabled:opacity-60">
                {placing ? "Đang gửi đơn…" : "Gửi đơn cho shop"}
              </button>
            </footer>
          </form>
        )}

        {step === "cart" && (
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <p role="status" className="mt-4 bg-[#fff0eb] px-3 py-2 text-xs font-semibold leading-5 text-[#a83826] empty:hidden">{stockNotice}</p>
          {rows.length > 0 && <ul aria-label="Món trong giỏ">{rows}</ul>}
          {items.length === 0 && (
            <p className="py-10 text-sm leading-6 text-[#706d67]">Giỏ đang trống. Chọn màu, size ở trang sản phẩm rồi bấm “Thêm vào giỏ”.</p>
          )}
        </div>
        )}

        {step === "cart" && items.length > 0 && (
          <footer className="border-t border-[#e3dfd8] px-5 py-4">
            {items.length >= CART_MAX_LINES && <p role="status" className="mb-3 bg-[#fff0eb] px-3 py-2 text-xs font-semibold leading-5 text-[#a83826]">Giỏ đã đủ {CART_MAX_LINES} món. Gửi đơn này trước rồi thêm tiếp nhé.</p>}
            <p className="flex justify-between text-base font-bold"><span>Tạm tính</span><span className="tabular-nums">{formatPrice(subtotal)}</span></p>
            {/* The policy can run long: folded away so the send button stays on a phone screen. */}
            <details className="group mt-2 text-xs leading-5 text-[#706d67]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold text-[#474640] [&::-webkit-details-marker]:hidden">
                Giao hàng và thanh toán
                <Icon name="chevron" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="max-h-40 space-y-2 overflow-y-auto pb-1">
                <p className="whitespace-pre-line">{shippingPolicy ? `Giao hàng: ${shippingPolicy}` : "Phí giao hàng: shop báo khi xác nhận đơn."}</p>
                <p>Bấm Đặt hàng để gửi đơn thẳng cho shop, hoặc gửi giỏ qua chat để hỏi thêm trước. Shop kiểm tra tồn kho và xác nhận trước khi giao.</p>
              </div>
            </details>
            <button type="button" onClick={() => { setCheckoutError(""); setFieldErrors({}); setStep("checkout"); }} className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#c2412b] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#a83826]">Đặt hàng</button>
            <button type="button" onClick={onSend} className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-5 text-sm font-semibold text-[#474640] underline-offset-4 hover:underline">Hỏi shop qua chat trước</button>
          </footer>
        )}
      </section>
    </div>
  );
}

function CheckoutField({ label, error, onChange, ...props }: Omit<ComponentProps<"input">, "onChange"> & {
  label: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#474640]">
      {label}
      <input
        {...props}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-lg border border-[#8f8a82] px-3 py-2 text-base font-normal text-[#171717] outline-none focus:border-[#171717] aria-invalid:border-[#b2382a]"
      />
      {error && <span id={id} className="text-xs font-semibold text-[#a83826]">{error}</span>}
    </label>
  );
}
