import { ReplyAssistant } from "./reply-assistant";

export default function ReplyAssistantPage() {
  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">Trợ lý trả lời</h1>
        <p className="mt-1 text-sm">Soạn và chỉnh sửa câu trả lời trước khi gửi cho khách.</p>
      </header>
      <ReplyAssistant />
    </section>
  );
}
