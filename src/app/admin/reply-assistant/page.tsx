import { Icon } from "@/components/ui/icon";
import { generateStaffDraft } from "./actions";
import { ReplyAssistant } from "./reply-assistant";

export default function ReplyAssistantPage() {
  return (
    <section className="mx-auto max-w-6xl space-y-7 lg:space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="ui-page-title">Trợ lý trả lời<span className="text-[#e9573f]">.</span></h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 lg:max-w-3xl text-[#706d67]">
            Dán câu hỏi của khách để tạo bản nháp. Bạn có thể chỉnh sửa rồi sao chép câu trả lời để gửi qua kênh đang dùng.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#e3dfd8] bg-white px-4 py-2 text-xs font-semibold text-[#474640]">
          <Icon name="spark" className="size-4 text-[#e9573f]" /> Hỗ trợ bởi ShopMate AI
        </span>
      </header>
      <ReplyAssistant generateDraftAction={generateStaffDraft} />
    </section>
  );
}
