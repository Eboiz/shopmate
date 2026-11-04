"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/text-area";
import { POLICY_LABELS, type PolicyType } from "@/lib/shop-data-validation";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type PolicyFormProps = {
  type: PolicyType;
  content: string;
  canEdit: boolean;
  updatePolicy: FormAction;
};

export function PolicyForm({ type, content, canEdit, updatePolicy }: PolicyFormProps) {
  const [state, formAction, pending] = useActionState(updatePolicy, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="type" value={type} />
      <TextArea
        label={POLICY_LABELS[type]}
        name="content"
        rows={4}
        defaultValue={content}
        readOnly={!canEdit}
        error={state.error}
      />
      {canEdit && (
        <Button type="submit" disabled={pending} className="self-end">
          Lưu
        </Button>
      )}
    </form>
  );
}
