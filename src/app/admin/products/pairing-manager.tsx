"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { SubmitButton } from "@/components/ui/submit-button";
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
        <form action={addAction} className="ui-card flex flex-col gap-4 p-5 sm:p-6">
          <ProductSelect
            label="Món thứ nhất"
            name="productId1"
            products={products}
            defaultValue={addState.values?.productId1}
          />
          <ProductSelect
            label="Món thứ hai"
            name="productId2"
            products={products}
            defaultValue={addState.values?.productId2}
          />
          <TextInput label="Lý do hợp nhau" name="reason" defaultValue={addState.values?.reason} />
          {addState.error && <ErrorMessage>{addState.error}</ErrorMessage>}
          <Button type="submit" loading={adding} loadingText="Đang thêm…">
            Thêm cặp phối đồ
          </Button>
        </form>
      )}
      {deleteState.error && <ErrorMessage>{deleteState.error}</ErrorMessage>}
      {pairings.length === 0 ? (
        <EmptyState icon="hanger" title="Chưa có cặp phối đồ" description="Khi khách hỏi mặc kèm gì, AI gợi ý theo các cặp ở đây." />
      ) : (
        <ul className="flex flex-col gap-2">
          {pairings.map((pairing) => (
            <PairingRow key={pairing.id} pairing={pairing} canEdit={canEdit} deleteAction={deleteAction} deleting={deleting} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PairingRow({
  pairing,
  canEdit,
  deleteAction,
  deleting,
}: {
  pairing: Pairing;
  canEdit: boolean;
  deleteAction: (formData: FormData) => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = `${pairing.productName1} + ${pairing.productName2}`;

  return (
    <li className="ui-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="text-sm text-[#706d67]">{pairing.reason}</p>
        </div>
        {canEdit && !confirming && (
          <Button variant="secondary" aria-label={`Xoá cặp ${name}`} title="Xoá" className="px-3!" onClick={() => setConfirming(true)}>
            <Icon name="trash" className="size-5" />
          </Button>
        )}
      </div>
      {canEdit && confirming && (
        // Deleting cannot be undone, so it takes a second, explicit step.
        <form action={deleteAction} role="group" aria-label={`Xác nhận xoá cặp ${name}`} className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-[#f3d3c9] bg-[#fff6f3] p-3">
          <input type="hidden" name="pairingId" value={pairing.id} />
          <p className="mr-auto text-sm">AI sẽ không gợi ý cặp này nữa. Xoá?</p>
          <Button variant="secondary" disabled={deleting} onClick={() => setConfirming(false)}>Giữ lại</Button>
          {/* Every row shares deleteAction: only the pressed row spins, the others wait. */}
          <SubmitButton variant="danger" loadingText="Đang xoá…" disabled={deleting}>Xoá cặp này</SubmitButton>
        </form>
      )}
    </li>
  );
}

function ProductSelect({
  label,
  name,
  products,
  defaultValue = "",
}: {
  label: string;
  name: string;
  products: ProductOption[];
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
      {label}
      {/* Keyed by the value so a failed add shows the products just picked: React
          doesn't re-apply defaultValue to a <select> when it resets the form. */}
      <select
        key={defaultValue}
        name={name}
        defaultValue={defaultValue}
        className="ui-field min-h-11 px-3 py-2 text-base"
      >
        <option value="">Chọn sản phẩm</option>
        {products.toSorted((a, b) => a.name.localeCompare(b.name, "vi")).map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>
    </label>
  );
}
