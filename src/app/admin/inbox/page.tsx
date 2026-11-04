import { EmptyState } from "@/components/ui/empty-state";

export default function InboxPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Hộp thư</h1>
      <EmptyState title="Sắp ra mắt" description="Các cuộc trò chuyện với khách sẽ hiện ở đây." />
    </>
  );
}
