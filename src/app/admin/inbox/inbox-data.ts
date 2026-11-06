import type { Channel, ConversationMode, MessageSender } from "@/contract";

export type InboxMessage = {
  id: string;
  sender: MessageSender;
  text: string;
  createdAt: string;
};

export type InboxConversation = {
  id: string;
  customerName: string;
  channel: Channel;
  mode: ConversationMode;
  lastMessageAt: string;
  messages: InboxMessage[];
};

export type InboxDataSource = {
  listConversations(): Promise<InboxConversation[]>;
  subscribe(onChange: (conversations: InboxConversation[]) => void): () => void;
  setMode(id: string, mode: Extract<ConversationMode, "ai" | "staff">): Promise<void>;
  sendMessage(id: string, text: string): Promise<void>;
};

function simulateRequest() {
  return new Promise<void>((resolve) => setTimeout(resolve, 180));
}

export function createDemoInbox() {
  const now = Date.now();
  let nextMessageId = 0;

  function message(sender: MessageSender, text: string, at = Date.now()): InboxMessage {
    return { id: `demo-message-${++nextMessageId}`, sender, text, createdAt: new Date(at).toISOString() };
  }

  function minutesAgo(minutes: number) {
    return now - minutes * 60_000;
  }

  const initialConversations: InboxConversation[] = [
    {
      id: "demo-thao",
      customerName: "Ngọc Thảo",
      channel: "messenger",
      mode: "needs_human",
      lastMessageAt: new Date(minutesAgo(8)).toISOString(),
      messages: [
        message("shopper", "Mình muốn đổi chiếc áo đã nhận sang cỡ M.", minutesAgo(10)),
        message("system", "Mình sẽ nhờ nhân viên hỗ trợ bạn đổi áo nhé.", minutesAgo(9)),
        message("shopper", "Mình vẫn giữ nguyên tem áo ạ.", minutesAgo(8)),
      ],
    },
    {
      id: "demo-mai",
      customerName: "Mai Anh",
      channel: "web",
      mode: "ai",
      lastMessageAt: new Date(minutesAgo(2)).toISOString(),
      messages: [
        message("shopper", "Áo sơ mi linen còn màu trắng cỡ S không?", minutesAgo(3)),
        message("ai", "Dạ, áo trắng cỡ S còn hàng ạ.", minutesAgo(2)),
      ],
    },
    {
      id: "demo-bao",
      customerName: "Bảo Ngọc",
      channel: "instagram",
      mode: "staff",
      lastMessageAt: new Date(minutesAgo(5)).toISOString(),
      messages: [
        message("shopper", "Mình cần nhận hàng trước thứ Bảy, shop kiểm tra giúp mình nhé.", minutesAgo(7)),
        message("staff", "Dạ, mình đang kiểm tra lịch giao hàng cho bạn.", minutesAgo(5)),
      ],
    },
    {
      id: "demo-lan",
      customerName: "Lan Phương",
      channel: "telegram",
      mode: "needs_human",
      lastMessageAt: new Date(minutesAgo(24)).toISOString(),
      messages: [
        message("shopper", "Mình đã chuyển khoản nhưng chưa thấy xác nhận.", minutesAgo(25)),
        message("system", "Nhân viên sẽ kiểm tra và phản hồi cho bạn tại đây.", minutesAgo(24)),
      ],
    },
  ];

  const conversations = new Map(initialConversations.map((conversation) => [conversation.id, conversation]));
  const listeners = new Set<(conversations: InboxConversation[]) => void>();

  function snapshot() {
    return [...conversations.values()];
  }

  function getConversation(id: string) {
    const conversation = conversations.get(id);
    if (!conversation) throw new Error("Conversation unavailable");
    return conversation;
  }

  function update(conversation: InboxConversation) {
    conversations.set(conversation.id, conversation);
    const updated = snapshot();
    listeners.forEach((listener) => listener(updated));
  }

  function append(conversation: InboxConversation, ...messages: InboxMessage[]) {
    update({
      ...conversation,
      messages: [...conversation.messages, ...messages],
      lastMessageAt: messages.at(-1)?.createdAt ?? conversation.lastMessageAt,
    });
  }

  const source: InboxDataSource = {
    async listConversations() {
      await simulateRequest();
      return snapshot();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    async setMode(id, mode) {
      await simulateRequest();
      update({ ...getConversation(id), mode });
    },
    async sendMessage(id, text) {
      await simulateRequest();
      const conversation = getConversation(id);
      if (conversation.mode !== "staff" || !text.trim()) throw new Error("Staff reply unavailable");
      append(conversation, message("staff", text.trim()));
    },
  };

  function simulateCustomerMessage(id: string) {
    const conversation = getConversation(id);
    const incoming = message("shopper", "Shop ơi, bạn kiểm tra giúp mình với ạ.");
    if (conversation.mode === "ai") {
      append(conversation, incoming, message("ai", "Dạ, mình đã nhận được tin nhắn của bạn ạ."));
    } else {
      append(conversation, incoming);
    }
  }

  function simulateHandoff(id: string) {
    const conversation = getConversation(id);
    if (conversation.mode === "ai") {
      append(
        { ...conversation, mode: "needs_human" },
        message("system", "Nhân viên sẽ tiếp tục hỗ trợ bạn tại đây."),
      );
    }
  }

  return { source, simulateCustomerMessage, simulateHandoff };
}
