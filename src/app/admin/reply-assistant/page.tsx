import { ReplyAssistant } from "./reply-assistant";

export default function ReplyAssistantPage() {
  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">Trợ lý trả lời</h1>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
            Dữ liệu mẫu
          </span>
        </div>
        <p className="mt-1 text-sm">Soạn và chỉnh sửa câu trả lời trước khi gửi cho khách.</p>
      </header>
      <ReplyAssistant />
    </section>
  );
}
