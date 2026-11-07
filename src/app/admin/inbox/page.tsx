import { sendStaffMessage } from "./actions";
import { StaffInbox } from "./staff-inbox";

export default function InboxPage() {
  return (
    <section className="mx-auto max-w-6xl">
      <header className="mb-7">
        <p className="ui-eyebrow mb-2">Giao tiếp khách hàng</p>
        <h1 className="ui-page-title">Hộp thư</h1>
        <p className="mt-2 text-sm text-[#706d67]">Theo dõi các cuộc trò chuyện và hỗ trợ khách kịp thời.</p>
      </header>
      <StaffInbox sendMessageAction={sendStaffMessage} />
    </section>
  );
}
