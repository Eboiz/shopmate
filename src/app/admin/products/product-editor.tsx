"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import { MAX_PRICE, MAX_STOCK } from "@/lib/shop-data-validation";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type Variant = { id: string; size: string; color: string; stock: number };

type ProductEditorProps = {
  product: { id: string; name: string; price: number; variants: Variant[] };
  canEdit: boolean;
  updatePrice: FormAction;
  updateStock: FormAction;
};

export function ProductEditor({
  product,
  canEdit,
  updatePrice,
  updateStock,
}: ProductEditorProps) {
  const [state, formAction, pending] = useActionState(updatePrice, INITIAL_FORM_STATE);

  return (
    <section className="ui-card flex flex-col gap-4 p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{product.name}</h2>
      <form action={formAction} className="flex items-start gap-2">
        <input type="hidden" name="productId" value={product.id} />
        <div className="min-w-0 flex-1">
          <TextInput
            label="Giá (đồng)"
            name="price"
            inputMode="numeric"
            maxLength={String(MAX_PRICE).length}
            defaultValue={state.values?.price ?? product.price}
            readOnly={!canEdit}
            error={state.error}
          />
        </div>
        {canEdit && (
          <Button type="submit" loading={pending} loadingText="Đang lưu…" className="mt-6">
            Lưu
          </Button>
        )}
      </form>
      {product.variants.map((variant) => (
        <StockForm
          key={variant.id}
          variant={variant}
          canEdit={canEdit}
          updateStock={updateStock}
        />
      ))}
    </section>
  );
}

function StockForm({
  variant,
  canEdit,
  updateStock,
}: {
  variant: Variant;
  canEdit: boolean;
  updateStock: FormAction;
}) {
  const [state, formAction, pending] = useActionState(updateStock, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="flex items-start gap-2">
      <input type="hidden" name="variantId" value={variant.id} />
      <div className="min-w-0 flex-1">
        <TextInput
          label={`Tồn kho: ${variant.size} / ${variant.color}`}
          name="stock"
          inputMode="numeric"
          maxLength={String(MAX_STOCK).length}
          defaultValue={state.values?.stock ?? variant.stock}
          readOnly={!canEdit}
          error={state.error}
        />
      </div>
      {canEdit && (
        <Button type="submit" variant="secondary" loading={pending} loadingText="Đang lưu…" className="mt-6">
          Lưu
        </Button>
      )}
    </form>
  );
}
