"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/text-input";
import { formatPrice } from "@/lib/format";
import { createManualOrder } from "../orders-data";

export type OrderFormProduct = {
  id: string;
  code: string;
  name: string;
  price: number;
  variants: { id: string; color: string; size: string; stock: number }[];
};

type Line = { key: string; productId: string; variantId: string; quantity: number };
type Customer = { name: string; phone: string; address: string };

let nextKey = 0;
const newLine = (): Line => ({ key: `line-${nextKey++}`, productId: "", variantId: "", quantity: 1 });

export function NewOrderForm({
  products,
  conversationId,
  initialCustomer,
}: {
  products: OrderFormProduct[];
  conversationId: string | null;
  initialCustomer: Customer;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [customer, setCustomer] = useState<Customer>(initialCustomer);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // One id per order being made: a retry after a lost answer returns the same order.
  const [clientOrderId] = useState(() => crypto.randomUUID());

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const filled = lines.filter((line) => line.variantId);
  const total = filled.reduce((sum, line) => sum + (productById.get(line.productId)?.price ?? 0) * line.quantity, 0);

  function update(key: string, change: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (filled.length === 0) {
      setError("Chọn ít nhất một sản phẩm, màu và size.");
      return;
    }
    // The same variant twice is one line with both quantities, as the database keeps it.
    const merged = new Map<string, { variantId: string; quantity: number; unitPrice: number }>();
    for (const line of filled) {
      const price = productById.get(line.productId)?.price ?? 0;
      const seen = merged.get(line.variantId);
      merged.set(line.variantId, { variantId: line.variantId, quantity: (seen?.quantity ?? 0) + line.quantity, unitPrice: price });
    }

    setPending(true);
    setError(undefined);
    try {
      const result = await createManualOrder({ clientOrderId, conversationId, items: [...merged.values()], customer });
      if (result.ok) {
        router.push("/admin/orders?created=1");
        return;
      }
      setError(result.message);
    } catch {
      setError("Chưa tạo được đơn hàng. Vui lòng thử lại.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset className="ui-card space-y-4 p-5 sm:p-6">
        <legend className="sr-only">Sản phẩm</legend>
        <h2 className="text-lg font-bold">Sản phẩm</h2>
        <ul className="space-y-4">
          {lines.map((line, index) => (
            <OrderLine
              key={line.key}
              index={index}
              line={line}
              products={products}
              product={productById.get(line.productId)}
              canRemove={lines.length > 1}
              onChange={(change) => update(line.key, change)}
              onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))}
            />
          ))}
        </ul>
        <Button variant="secondary" disabled={lines.length >= 20} onClick={() => setLines((current) => [...current, newLine()])}>
          + Thêm sản phẩm
        </Button>
        <p className="flex justify-between border-t border-[#e3dfd8] pt-4 text-base font-bold">
          <span>Tổng tiền hàng</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </p>
        <p className="text-xs text-[#706d67]">Chưa gồm phí giao hàng. Tồn kho chỉ bị trừ khi shop bấm Xác nhận ở danh sách đơn.</p>
      </fieldset>

      <fieldset className="ui-card space-y-4 p-5 sm:p-6">
        <legend className="sr-only">Thông tin khách</legend>
        <h2 className="text-lg font-bold">Thông tin khách</h2>
        <TextInput label="Họ tên" autoComplete="off" required maxLength={100} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
        <TextInput label="Số điện thoại" type="tel" inputMode="tel" autoComplete="off" required value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
        <TextInput label="Địa chỉ giao hàng" autoComplete="off" required maxLength={300} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
      </fieldset>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      <Button type="submit" loading={pending} loadingText="Đang tạo đơn…" className="w-full sm:w-auto">
        <Icon name="check" className="size-4" />
        Tạo đơn chờ xác nhận
      </Button>
    </form>
  );
}

function OrderLine({
  index,
  line,
  products,
  product,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  line: Line;
  products: OrderFormProduct[];
  product: OrderFormProduct | undefined;
  canRemove: boolean;
  onChange: (change: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const variant = product?.variants.find((v) => v.id === line.variantId);
  const max = Math.max(1, Math.min(99, variant?.stock ?? 99));
  const field = "ui-field min-h-11 w-full px-3 py-2 text-base";

  return (
    <li className="grid gap-3 border-b border-[#e3dfd8] pb-4 sm:grid-cols-[1fr_180px_96px_auto] sm:items-end">
      <label htmlFor={`${id}-product`} className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
        Sản phẩm {index + 1}
        <select
          id={`${id}-product`}
          className={field}
          value={line.productId}
          onChange={(e) => onChange({ productId: e.target.value, variantId: "", quantity: 1 })}
        >
          <option value="">Chọn sản phẩm…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name} · {formatPrice(p.price)}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-variant`} className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
        Màu · Size
        <select
          id={`${id}-variant`}
          className={field}
          value={line.variantId}
          disabled={!product}
          onChange={(e) => onChange({ variantId: e.target.value, quantity: 1 })}
        >
          <option value="">Chọn…</option>
          {product?.variants.map((v) => (
            <option key={v.id} value={v.id} disabled={v.stock <= 0}>
              {v.color} · {v.size} {v.stock <= 0 ? "(hết hàng)" : `(còn ${v.stock})`}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-qty`} className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
        Số lượng
        <input
          id={`${id}-qty`}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          className={field}
          value={line.quantity}
          onChange={(e) => onChange({ quantity: Math.max(1, Math.min(max, Math.trunc(Number(e.target.value) || 1))) })}
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Bỏ sản phẩm ${index + 1}`}
        className="inline-grid size-11 place-items-center justify-self-end rounded-lg text-[#706d67] hover:bg-[#fff0eb] hover:text-[#b2382a] disabled:opacity-30"
      >
        <Icon name="trash" className="size-5" />
      </button>
    </li>
  );
}
