import { requireStaff } from "@/lib/auth";
import { sendStaffMessage } from "./actions";
import { StaffInbox } from "./staff-inbox";

// Rendered inside the Suspense boundary of the admin layout. ?c= opens one
// conversation (links from orders, the dashboard, and "AI đã học").
export default async function InboxPage({ searchParams }: PageProps<"/admin/inbox">) {
  const { c } = await searchParams;
  const { userId } = await requireStaff();
  return (
    <section className="mx-auto max-w-7xl">
      {/* Kept short: the inbox below fills the rest of the screen. */}
      <header className="mb-5">
        <h1 className="ui-page-title">Hộp thư</h1>
      </header>
      <StaffInbox sendMessageAction={sendStaffMessage} initialSelectedId={typeof c === "string" ? c : undefined} currentUserId={userId} />
    </section>
  );
}
