import { Suspense } from "react";
import { StaffInbox } from "./staff-inbox";

export default function InboxPage({ searchParams }: PageProps<"/admin/inbox">) {
  return (
    <Suspense fallback={<p role="status">Đang tải hộp thư…</p>}>
      <InboxWithMode searchParams={searchParams} />
    </Suspense>
  );
}

async function InboxWithMode({ searchParams }: Pick<PageProps<"/admin/inbox">, "searchParams">) {
  const demo = (await searchParams).demo === "1";

  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">Hộp thư</h1>
        {demo && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
            Dữ liệu mẫu
          </span>
        )}
      </header>
      <StaffInbox key={demo ? "demo" : "live"} demo={demo} />
    </section>
  );
}
