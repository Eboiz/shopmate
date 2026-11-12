import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { getLearningPage } from "./data";
import { LearnedCard, ModeSwitch, PendingCard, QuestionList, RequestCard } from "./learning-ui";

const TABS = [
  { id: "pending", label: "Chờ duyệt" },
  { id: "learned", label: "Đã học" },
  { id: "open", label: "Chưa ai trả lời" },
  { id: "requests", label: "Món chưa có" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Rendered inside the Suspense boundary of the admin layout, which already
// checked the session; requireStaff reads the role and shop for this page.
export default async function LearningPage({ searchParams }: PageProps<"/admin/ai-da-hoc">) {
  const requested = (await searchParams).tab;
  const { shopId, role } = await requireStaff();
  await connection(); // the 7-day window reads the clock: render per request
  const data = await getLearningPage(shopId);
  const canEdit = role === "owner";
  const counts: Record<TabId, number> = {
    pending: data.pending.length,
    learned: data.learned.length,
    open: data.questions.length,
    requests: data.requests.length,
  };
  // Without ?tab=, open "Chờ duyệt" when something waits, else "Đã học".
  const tab = TABS.find(({ id }) => id === requested)?.id ?? (counts.pending > 0 ? "pending" : "learned");

  return (
    <>
      <header className="mb-7">
        <p className="ui-eyebrow mb-2">Dữ liệu AI dùng</p>
        <h1 className="ui-page-title">AI đã học</h1>
        <p className="mt-2 text-sm text-[#706d67]">
          Những điều AI học từ câu nhân viên trả lời khách, và câu hỏi AI chưa trả lời được.
        </p>
      </header>
      <div className="mb-5">
        <ModeSwitch mode={data.mode} canEdit={canEdit} />
      </div>
      <nav aria-label="Mục" className="mb-6 flex gap-2 overflow-x-auto border-b border-[#e3dfd8] pb-2">
        {TABS.map(({ id, label }) => (
          <Link
            key={id}
            href={`/admin/ai-da-hoc?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm transition-colors ${
              tab === id ? "bg-[#171717] font-semibold text-white" : "text-[#706d67] hover:bg-[#efebe4]"
            }`}
          >
            {label}
            <span
              className={`rounded-full px-1.5 text-xs font-semibold ${
                tab === id ? "bg-white/20" : (id === "pending" || id === "open") && counts[id] > 0 ? "bg-[#c2412b] text-white" : "bg-[#efebe4] text-[#474640]"
              }`}
            >
              {counts[id]}
            </span>
          </Link>
        ))}
      </nav>
      {!canEdit && (
        <p className="mb-4 text-sm text-zinc-500">
          Bạn đang xem với quyền nhân viên. Chỉ chủ shop được thay đổi.
        </p>
      )}

      {tab === "pending" &&
        (data.pending.length === 0 ? (
          <EmptyState title="Không có mục nào chờ duyệt" description="Câu AI học được mà cần chủ shop xem lại sẽ hiện ở đây." />
        ) : (
          <div className="flex flex-col gap-4">
            {data.pending.map((fact) => <PendingCard key={fact.id} fact={fact} canEdit={canEdit} />)}
          </div>
        ))}

      {tab === "learned" &&
        (data.learned.length === 0 ? (
          <EmptyState title="AI chưa học thêm điều gì" description="Khi nhân viên trả lời câu AI chưa trả lời được, câu đó sẽ hiện ở đây." />
        ) : (
          <div className="flex flex-col gap-4">
            {data.learned.map((fact) => <LearnedCard key={fact.id} fact={fact} canEdit={canEdit} />)}
          </div>
        ))}

      {tab === "open" && <QuestionList questions={data.questions} canEdit={canEdit} />}

      {tab === "requests" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[#706d67]">Khách tìm món shop chưa có, trong 7 ngày gần nhất. Chỉ để xem.</p>
          {data.requests.length === 0 ? (
            <EmptyState title="Chưa có món nào khách tìm mà shop chưa có" />
          ) : (
            data.requests.map((gap) => <RequestCard key={gap.id} gap={gap} canEdit={canEdit} />)
          )}
        </div>
      )}
    </>
  );
}
