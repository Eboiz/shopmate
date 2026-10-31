"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { TextInput } from "@/components/ui/text-input";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type ProductOption = { id: string; name: string };
type Pairing = { id: string; productName1: string; productName2: string; reason: string };

type PairingManagerProps = {
  products: ProductOption[];
  pairings: Pairing[];
  canEdit: boolean;
  addPairing: FormAction;
  deletePairing: FormAction;
};

export function PairingManager({
  products,
  pairings,
  canEdit,
  addPairing,
  deletePairing,
}: PairingManagerProps) {
  const [addState, addAction, adding] = useActionState(addPairing, INITIAL_FORM_STATE);
  const [deleteState, deleteAction, deleting] = useActionState(
    deletePairing,
    INITIAL_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <form action={addAction} className="flex flex-col gap-3">
          <ProductSelect label="Món thứ nhất" name="productId1" products={products} />
          <ProductSelect label="Món thứ hai" name="productId2" products={products} />
          <TextInput label="Lý do hợp nhau" name="reason" />
          {addState.error && <ErrorMessage>{addState.error}</ErrorMessage>}
          <Button type="submit" disabled={adding}>
            Thêm cặp phối đồ
          </Button>
        </form>
      )}
      {deleteState.error && <ErrorMessage>{deleteState.error}</ErrorMessage>}
      {pairings.length === 0 ? (
        <EmptyState title="Chưa có cặp phối đồ" />
      ) : (
        <ul className="flex flex-col gap-2">
          {pairings.map((pairing) => (
            <li
              key={pairing.id}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {pairing.productName1} + {pairing.productName2}
                </p>
                <p className="text-sm text-zinc-500">{pairing.reason}</p>
              </div>
              {canEdit && (
                <form action={deleteAction}>
                  <input type="hidden" name="pairingId" value={pairing.id} />
                  <Button type="submit" variant="danger" disabled={deleting}>
                    Xoá
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductSelect({
  label,
  name,
  products,
}: {
  label: string;
  name: string;
  products: ProductOption[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        name={name}
        defaultValue=""
        className="min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-base"
      >
        <option value="">Chọn sản phẩm</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>
    </label>
  );
}
