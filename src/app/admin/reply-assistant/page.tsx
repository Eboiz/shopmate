import { EmptyState } from "@/components/ui/empty-state";

export default function ReplyAssistantPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Trợ lý trả lời</h1>
      <EmptyState title="Sắp ra mắt" description="Dán câu hỏi của khách để nhận câu trả lời gợi ý." />
    </>
  );
}
