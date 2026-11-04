"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
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
    <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3">
      <h2 className="font-medium">{product.name}</h2>
      <form action={formAction} className="flex items-start gap-2">
        <input type="hidden" name="productId" value={product.id} />
        <div className="min-w-0 flex-1">
          <TextInput
            label="Giá (đồng)"
            name="price"
            inputMode="numeric"
            defaultValue={product.price}
            readOnly={!canEdit}
            error={state.error}
          />
        </div>
        {canEdit && (
          <Button type="submit" disabled={pending} className="mt-6">
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
          defaultValue={variant.stock}
          readOnly={!canEdit}
          error={state.error}
        />
      </div>
      {canEdit && (
        <Button type="submit" variant="secondary" disabled={pending} className="mt-6">
          Lưu
        </Button>
      )}
    </form>
  );
}
