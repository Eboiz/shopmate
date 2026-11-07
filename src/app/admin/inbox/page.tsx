import { StaffInbox } from "./staff-inbox";

export default function InboxPage() {
  return (
    <section className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-xl font-semibold">Hộp thư</h1>
      <StaffInbox />
    </section>
  );
}
