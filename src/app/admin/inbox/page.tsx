import { sendStaffMessage } from "./actions";
import { StaffInbox } from "./staff-inbox";

// ?c=<conversation id> opens that conversation (links from "AI đã học").
// An unknown id just shows the list.
export default async function InboxPage({ searchParams }: PageProps<"/admin/inbox">) {
  const { c } = await searchParams;
  return (
    <section className="mx-auto max-w-7xl">
      {/* Kept short: the inbox below fills the rest of the screen. */}
      <header className="mb-5">
        <p className="ui-eyebrow mb-2">Giao tiếp khách hàng</p>
        <h1 className="ui-page-title">Hộp thư</h1>
      </header>
      <StaffInbox sendMessageAction={sendStaffMessage} initialSelectedId={typeof c === "string" ? c : undefined} />
    </section>
  );
}
