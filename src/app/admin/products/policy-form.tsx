"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/text-area";
import type { PolicyKind } from "@/contract";
import { POLICY_LABELS } from "@/lib/shop-data-validation";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type PolicyFormProps = {
  type: PolicyKind;
  content: string;
  canEdit: boolean;
  updatePolicy: FormAction;
};

export function PolicyForm({ type, content, canEdit, updatePolicy }: PolicyFormProps) {
  if (!canEdit) {
    // Staff read the policy as text, not as a box that looks typeable.
    return (
      <section className="ui-card flex flex-col gap-2 p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-[#474640]">{POLICY_LABELS[type]}</h2>
        {content.trim() ? (
          <p className="whitespace-pre-line text-sm leading-6">{content}</p>
        ) : (
          <p className="text-sm text-[#706d67]">Shop chưa có chính sách này. Khách hỏi sẽ được chuyển cho nhân viên.</p>
        )}
      </section>
    );
  }
  return <PolicyEditor type={type} content={content} updatePolicy={updatePolicy} />;
}

function PolicyEditor({ type, content, updatePolicy }: Omit<PolicyFormProps, "canEdit">) {
  const [state, formAction, pending] = useActionState(updatePolicy, INITIAL_FORM_STATE);
  const [text, setText] = useState(state.values?.content ?? content);
  const dirty = text.trim() !== content.trim();
  const saved = state !== INITIAL_FORM_STATE && state.error === null && !dirty && !pending;

  return (
    <form action={formAction} className="ui-card flex flex-col gap-4 p-5 sm:p-6">
      <input type="hidden" name="type" value={type} />
      <TextArea
        label={POLICY_LABELS[type]}
        name="content"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        error={dirty ? state.error : null}
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved && <p role="status" className="mr-auto text-sm text-[#2f6b3a]">Đã lưu. AI trả lời theo chính sách mới.</p>}
        {dirty && !pending && <span className="mr-auto text-xs text-[#706d67]">Chưa lưu</span>}
        <Button type="submit" loading={pending} loadingText="Đang lưu…" disabled={!dirty}>
          Lưu {POLICY_LABELS[type].toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
