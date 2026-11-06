import type { Channel, Reply } from "@/contract";
import { sendMessenger } from "./messenger";
import { sendTelegram } from "./telegram";

// Where a reply goes: the shopper's id on the channel, and the shop's account on
// that channel (null for web chat).
export type DeliveryTarget = {
  channel: Channel;
  externalId: string;
  channelAccount: { id: string; externalAccountId: string; accessToken: string } | null;
};

// Sends a reply on one channel. Throws when the channel refuses it.
export type ChannelAdapter = (target: DeliveryTarget, reply: Reply) => Promise<void>;

function notImplemented(story: string): ChannelAdapter {
  return async () => {
    throw new Error(`not_implemented: this channel's adapter is built in ${story}`);
  };
}

// One adapter per channel; the engine never knows which channel it serves.
// Each channel story replaces its entry with the real Send API call.
export const adapters: Record<Channel, ChannelAdapter> = {
  // Web chat reads the stored message through the server API (PB-04), so there
  // is nothing to push.
  web: async () => {},
  messenger: sendMessenger,
  telegram: sendTelegram,
  instagram: notImplemented("PB-23"),
  whatsapp: notImplemented("PB-27"),
};
