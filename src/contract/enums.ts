import { z } from "zod";
import { Constants } from "./database.types";

// Built from the generated database enums, so Zod and Postgres can't drift apart.
const dbEnums = Constants.public.Enums;

export const channelSchema = z.enum(dbEnums.channel);
export const conversationModeSchema = z.enum(dbEnums.conversation_mode);
export const engineModeSchema = z.enum(dbEnums.engine_mode);
// PB-14 triggers; postcheck_failed and too_many_tool_calls are raised by the server.
export const handoffReasonSchema = z.enum(dbEnums.handoff_reason);
export const messageSenderSchema = z.enum(dbEnums.message_sender);
export const orderStatusSchema = z.enum(dbEnums.order_status);
export const policyKindSchema = z.enum(dbEnums.policy_kind);
export const profileRoleSchema = z.enum(dbEnums.profile_role);

export type Channel = z.infer<typeof channelSchema>;
export type ConversationMode = z.infer<typeof conversationModeSchema>;
export type EngineMode = z.infer<typeof engineModeSchema>;
export type HandoffReason = z.infer<typeof handoffReasonSchema>;
export type MessageSender = z.infer<typeof messageSenderSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type PolicyKind = z.infer<typeof policyKindSchema>;
export type ProfileRole = z.infer<typeof profileRoleSchema>;

// Database ids. z.guid accepts any 8-4-4-4-12 id (seed scripts may use fixed ids).
export const idSchema = z.guid();

// Money is a whole number of đồng (products.price is capped below 100,000,000).
export const vndSchema = z.int().nonnegative();
