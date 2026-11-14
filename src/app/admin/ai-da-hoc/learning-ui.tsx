"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/text-area";
import { hasBlank, type MissingItemProposal, type PolicyKind } from "@/contract";
import { POLICY_KINDS, POLICY_LABELS } from "@/lib/shop-data-validation";
import { INITIAL_FORM_STATE, type FormAction, type FormState } from "../products/form-state";
import {
  analyzeMissingItemsAction,
  approveLearned,
  approveTopic,
  changeLearningMode,
  dismissQuestions,
  draftTopics,
  editLearned,
  removeLearned,
  type DraftTopic,
} from "./actions";
import type { FactView, GapView } from "./data";

type LearningMode = "auto" | "review";

const MODE_LABELS: Record<LearningMode, string> = { auto: "Tự động học", review: "Duyệt trước khi dùng" };

// Runs `onDone` after a successful action, e.g. to close an edit box.
function useDecision(action: FormAction, onDone?: () => void) {
  return useActionState(async (prev: FormState, formData: FormData) => {
    const state = await action(prev, formData);
    if (!state.error) onDone?.();
    return state;
  }, INITIAL_FORM_STATE);
}

function ConversationLink({ id }: { id: string | null }) {
  if (!id) return null;
  return (
    <Link href={`/admin/inbox?c=${id}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#c2412b] hover:underline">
      Xem hội thoại <Icon name="arrow" className="size-3.5" />
    </Link>
  );
}

function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  const color = tone === "warn" ? "bg-[#fff0eb] text-[#b2382a]" : "bg-[#efebe4] text-[#171717]";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{children}</span>;
}

export function ModeSwitch({ mode, canEdit }: { mode: LearningMode; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(changeLearningMode, INITIAL_FORM_STATE);
  if (!canEdit) {
    return (
      <p className="ui-card flex flex-wrap items-center gap-2 p-4 text-sm">
        Chế độ học: <strong>{MODE_LABELS[mode]}</strong>
        <span className="text-[#706d67]">Chỉ chủ shop đổi được.</span>
      </p>
    );
  }
  return (
    <form action={formAction} className="ui-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-sm font-semibold">Cách AI học</h2>
      <div role="group" aria-label="Cách AI học" className="grid grid-cols-2 gap-1 rounded-xl bg-[#efebe4] p-1">
        {(["auto", "review"] as const).map((value) => (
          <button
            key={value}
            type="submit"
            name="mode"
            value={value}
            disabled={pending}
            aria-pressed={mode === value}
            className={`min-h-11 rounded-lg px-3 text-sm transition-colors disabled:opacity-60 ${
              mode === value ? "bg-[#171717] font-semibold text-white" : "text-[#474640] hover:bg-white"
            }`}
          >
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
    </form>
  );
}

function Source({ fact }: { fact: FactView }) {
  if (!fact.staffText) return <p className="text-sm text-[#706d67]">Chủ shop tự viết.</p>;
  return (
    <blockquote className="border-l-2 border-[#e3dfd8] pl-3 text-sm text-[#474640]">
      {fact.question && <p className="text-[#706d67]">Khách hỏi: “{fact.question}”</p>}
      <p>Nhân viên trả lời: “{fact.staffText}”</p>
    </blockquote>
  );
}

function FactHeader({ fact, warn }: { fact: FactView; warn?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1.5">
        {warn && fact.reasons.map((reason) => <Pill key={reason} tone="warn">{reason}</Pill>)}
        <Pill>{fact.label}</Pill>
      </div>
      <time className="text-xs text-[#706d67]">{fact.time}</time>
    </div>
  );
}

export function LearnedCard({ fact, canEdit }: { fact: FactView; canEdit: boolean }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [editState, editAction, saving] = useDecision(editLearned, () => setMode("view"));
  const [removeState, removeAction, removing] = useDecision(removeLearned);

  if (mode === "edit") {
    return (
      <form action={editAction} className="ui-card flex flex-col gap-3 p-5">
        <FactHeader fact={fact} />
        <input type="hidden" name="factId" value={fact.id} />
        <TextArea label="Câu AI dùng" name="text" rows={3} maxLength={500} defaultValue={editState.values?.text ?? fact.text} error={editState.error} />
        <div className="flex gap-2 self-end">
          <Button variant="secondary" onClick={() => setMode("view")} disabled={saving}>Thôi</Button>
          <Button type="submit" loading={saving} loadingText="Đang lưu…">Lưu</Button>
        </div>
      </form>
    );
  }

  return (
    <article className="ui-card flex flex-col gap-3 p-5">
      <FactHeader fact={fact} />
      <p className="font-medium">{fact.text}</p>
      <Source fact={fact} />
      <ConversationLink id={fact.conversationId} />
      {removeState.error && <ErrorMessage>{removeState.error}</ErrorMessage>}
      {canEdit && mode === "view" && (
        <div className="flex gap-2 self-end">
          <Button variant="secondary" onClick={() => setMode("edit")}>Sửa</Button>
          <Button variant="secondary" onClick={() => setMode("confirm")}>Gỡ</Button>
        </div>
      )}
      {canEdit && mode === "confirm" && (
        <form action={removeAction} className="flex flex-col gap-3 rounded-xl border border-[#f3d3c9] bg-[#fff6f3] p-4">
          <input type="hidden" name="factId" value={fact.id} />
          <p className="text-sm">Gỡ câu này? AI ngừng dùng ngay, khách hỏi lại sẽ được chuyển cho nhân viên.</p>
          <div className="flex gap-2 self-end">
            <Button variant="secondary" onClick={() => setMode("view")} disabled={removing}>Giữ lại</Button>
            <Button type="submit" variant="danger" loading={removing} loadingText="Đang gỡ…">Gỡ</Button>
          </div>
        </form>
      )}
    </article>
  );
}

export function PendingCard({ fact, canEdit }: { fact: FactView; canEdit: boolean }) {
  const [approveState, approveAction, approving] = useDecision(approveLearned);
  const [rejectState, rejectAction, rejecting] = useDecision(removeLearned);
  const error = approveState.error ?? rejectState.error;

  return (
    <form className="ui-card flex flex-col gap-3 p-5">
      <FactHeader fact={fact} warn />
      <input type="hidden" name="factId" value={fact.id} />
      <p className="font-medium">{fact.text}</p>
      <Source fact={fact} />
      <ConversationLink id={fact.conversationId} />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {canEdit ? (
        <div className="flex gap-2 self-end">
          <Button type="submit" variant="secondary" formAction={rejectAction} loading={rejecting} disabled={approving} loadingText="Đang bỏ…">Bỏ</Button>
          <Button type="submit" formAction={approveAction} loading={approving} disabled={rejecting} loadingText="Đang duyệt…">Duyệt</Button>
        </div>
      ) : (
        <p className="text-sm text-[#706d67]">Chờ chủ shop duyệt.</p>
      )}
    </form>
  );
}

export function QuestionList({ questions, canEdit }: { questions: GapView[]; canEdit: boolean }) {
  const [draft, setDraft] = useState<{ status: "idle" | "error"; topics: DraftTopic[] | null; error?: string }>({ status: "idle", topics: null });
  const [running, startDraft] = useTransition();

  if (questions.length === 0) {
    return <EmptyState title="Chưa có câu hỏi nào AI chưa trả lời được" description="Tính trong 7 ngày gần nhất." />;
  }

  function runDraft() {
    startDraft(async () => {
      const result = await draftTopics();
      setDraft(result.ok ? { status: "idle", topics: result.topics } : { status: "error", topics: null, error: result.error });
    });
  }

  const dropTopic = (topic: DraftTopic) => setDraft((current) => ({ ...current, topics: current.topics?.filter((t) => t !== topic) ?? null }));

  return (
    <div className="flex flex-col gap-4">
      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3dfd8] p-4">
          <p className="text-sm text-[#474640]">
            {questions.length} câu trong 7 ngày gần nhất.
            {!canEdit && " Mở hội thoại để trả lời, AI sẽ học từ câu bạn trả lời."}
          </p>
          {canEdit && (
            <Button variant="secondary" onClick={runDraft} loading={running} loadingText="Đang soạn…">
              Soạn câu trả lời
            </Button>
          )}
        </div>
        <ul aria-label="Câu hỏi chưa ai trả lời" className="divide-y divide-[#e3dfd8]">
          {questions.map((q) => (
            <li key={q.id} className="flex flex-col gap-1 px-4 py-3">
              <p className="font-medium">“{q.question}”</p>
              <div className="flex flex-wrap items-center gap-x-3 text-xs text-[#706d67]">
                <span>{q.reasonLabel}</span>
                {q.softDeclined && <span>Khách đã từ chối gặp nhân viên</span>}
                <time>{q.time}</time>
                <span className="ml-auto"><ConversationLink id={q.conversationId} /></span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {draft.status === "error" && <ErrorMessage>{draft.error}</ErrorMessage>}
      {draft.topics && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Chủ đề AI gộp được</h2>
          {draft.topics.length === 0 ? (
            <p className="text-sm text-[#706d67]">Chưa gộp được chủ đề nào (cần ít nhất 2 khách hỏi cùng một chuyện).</p>
          ) : (
            <>
              <p className="text-sm text-[#706d67]">Điền chỗ trong ngoặc vuông rồi bấm Duyệt. AI dùng câu này từ lượt tiếp theo.</p>
              {draft.topics.map((topic) => (
                <TopicCard key={topic.openIds.join(",")} topic={topic} onDone={() => dropTopic(topic)} />
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function TopicCard({ topic, onDone }: { topic: DraftTopic; onDone: () => void }) {
  const [kind, setKind] = useState<PolicyKind>(topic.policyKind);
  const [text, setText] = useState(topic.draft);
  const [approveState, approveAction, approving] = useDecision(approveTopic, onDone);
  const [dismissState, dismissAction, dismissing] = useDecision(dismissQuestions, onDone);
  const blank = hasBlank(text);
  const hintId = `hint-${topic.openIds[0]}`;

  return (
    <form className="ui-card flex flex-col gap-3 p-5">
      <input type="hidden" name="gapIds" value={topic.openIds.join(",")} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{topic.title}</h3>
        <Pill tone="warn">{topic.conversationCount} khách hỏi</Pill>
      </div>
      {topic.askedAgain && <div><Pill>Đã bổ sung nhưng khách vẫn hỏi</Pill></div>}
      <ul aria-label="Câu khách hỏi" className="list-disc pl-5 text-sm text-[#474640]">
        {topic.sampleQuestions.map((sample) => <li key={sample}>“{sample}”</li>)}
      </ul>
      <label className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
        Loại chính sách
        <select name="policyKind" value={kind} onChange={(e) => setKind(e.target.value as PolicyKind)} className="ui-field min-h-11 px-3 py-2 text-base">
          {POLICY_KINDS.map((k) => <option key={k} value={k}>{POLICY_LABELS[k]}</option>)}
        </select>
      </label>
      <TextArea
        label="Câu AI sẽ dùng"
        name="text"
        rows={3}
        maxLength={500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={blank ? hintId : undefined}
        error={approveState.error ?? dismissState.error}
      />
      {blank && (
        <p id={hintId} className="text-sm text-[#b2382a]">
          Còn chỗ trống trong ngoặc vuông [...]. Thay bằng câu trả lời thật của shop thì mới duyệt được.
        </p>
      )}
      <div className="flex gap-2 self-end">
        <Button type="submit" variant="secondary" formAction={dismissAction} loading={dismissing} disabled={approving} loadingText="Đang bỏ qua…">Bỏ qua</Button>
        <Button type="submit" formAction={approveAction} loading={approving} disabled={blank || dismissing} loadingText="Đang duyệt…">Duyệt</Button>
      </div>
    </form>
  );
}

export function RequestCard({ gap, canEdit }: { gap: GapView; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(dismissQuestions, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="ui-card flex flex-col gap-2 p-4">
      <input type="hidden" name="gapIds" value={gap.id} />
      <p className="font-medium">“{gap.question}”</p>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-[#706d67]">
        <time>{gap.time}</time>
        <ConversationLink id={gap.conversationId} />
        {canEdit && (
          <Button type="submit" variant="secondary" loading={pending} loadingText="Đang lưu…" className="ml-auto">Đã xem</Button>
        )}
      </div>
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
    </form>
  );
}

const formatPrice = (price: number) => `${new Intl.NumberFormat("vi-VN").format(price)}đ`;

function MissingItemCard({ group, canEdit }: { group: MissingItemProposal; canEdit: boolean }) {
  // "Đã xem" hides the group at once: the analysed groups are client state, so a
  // refresh of the page data alone would leave it on screen.
  const [dismissed, setDismissed] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    const next = await dismissQuestions(prev, formData);
    if (!next.error) setDismissed(true);
    return next;
  }, INITIAL_FORM_STATE);
  if (dismissed) return null;
  return (
    <form action={formAction} className="ui-card flex flex-col gap-3 p-4">
      <input type="hidden" name="gapIds" value={group.questionIds.join(",")} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold text-[#1c1a17]">{group.item}</h3>
        <span className="rounded-full bg-[#f4f1ea] px-2.5 py-0.5 text-xs font-medium text-[#57534e]">
          {group.conversationCount} khách hỏi
        </span>
      </div>
      <ul className="space-y-1 text-sm text-[#57534e]">
        {group.sampleQuestions.map((q, i) => (
          <li key={i}>“{q}”</li>
        ))}
      </ul>
      <div className="rounded-lg bg-[#faf8f4] p-3">
        <p className="text-xs font-medium text-[#706d67]">Món gần giống trong shop</p>
        {group.closestProducts.length === 0 ? (
          <p className="mt-1 text-sm text-[#706d67]">Không có món gần giống</p>
        ) : (
          <ul className="mt-1.5 space-y-1 text-sm text-[#1c1a17]">
            {group.closestProducts.map((p) => (
              <li key={p.productId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-[#706d67]">
                  {formatPrice(p.price)} · {p.stock > 0 ? `Còn ${p.stock}` : "Hết hàng"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <Button type="submit" variant="secondary" loading={pending} loadingText="Đang lưu…">
            Đã xem
          </Button>
        </div>
      )}
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
    </form>
  );
}

/**
 * PB-36: "Khách tìm món shop chưa có" section on /admin/ai-da-hoc.
 * Both owner and staff can view and run "Phân tích"; only owner sees "Đã xem".
 */
export function MissingItemsSection({ requests, canEdit }: { requests: GapView[]; canEdit: boolean }) {
  const [items, setItems] = useState<MissingItemProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAnalyze() {
    setError(null);
    startTransition(async () => {
      const res = await analyzeMissingItemsAction();
      if (res.ok) setItems(res.items);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[#1c1a17]">Khách tìm món shop chưa có</h2>
          <p className="text-sm text-[#706d67]">Trong 7 ngày gần nhất. Chỉ để xem.</p>
        </div>
        {requests.length > 0 && (
          <Button type="button" onClick={handleAnalyze} loading={pending} loadingText="Đang phân tích…">
            Phân tích
          </Button>
        )}
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {requests.length === 0 ? (
        <EmptyState title="Chưa có món nào khách tìm mà shop chưa có" />
      ) : items === null ? (
        requests.map((gap) => <RequestCard key={gap.id} gap={gap} canEdit={canEdit} />)
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có món nào được từ 2 khách trở lên hỏi" />
      ) : (
        items.map((group) => (
          <MissingItemCard key={group.questionIds.join(",")} group={group} canEdit={canEdit} />
        ))
      )}
    </div>
  );
}
