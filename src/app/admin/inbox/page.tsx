import { sendStaffMessage } from "./actions";
import { StaffInbox } from "./staff-inbox";

export default function InboxPage() {
  return (
    <section className="mx-auto max-w-7xl">
      {/* Kept short: the inbox below fills the rest of the screen. */}
      <header className="mb-5">
        <p className="ui-eyebrow mb-2">Giao tiếp khách hàng</p>
        <h1 className="ui-page-title">Hộp thư</h1>
      </header>
      <StaffInbox sendMessageAction={sendStaffMessage} />
    </section>
  );
}
