import { z } from "zod";
import {
  handoffReasonSchema,
  idSchema,
  policyKindSchema,
  vndSchema,
  type EngineMode,
} from "./enums";

// Added by the server to every tool call, never chosen by the model: the tool
// input schemas below have no shop_id and reject unknown keys.
export type ToolContext = {
  shopId: string;
  // null in staff_draft mode (PB-20 has no conversation).
  conversationId: string | null;
};


const stock = z.int().nonnegative();
const sizes = z.array(z.string());
const orderItems = z
  .array(z.strictObject({ variantId: idSchema, quantity: z.int().min(1).max(99) }))
  .min(1)
  .max(20);

export const tools = {
  search_products: {
    writes: false,
    description:
      "Find the shop's products by name or type. Works with or without Vietnamese diacritics.",
    input: z.strictObject({
      query: z.string().trim().min(1).max(100),
      limit: z.int().min(1).max(10).default(5),
    }),
    output: z.object({
      products: z.array(
        z.object({
          productId: idSchema,
          name: z.string(),
          category: z.string().nullable(),
          price: vndSchema,
          imageUrl: z.string().nullable(),
          colors: z.array(z.string()),
          sizes,
        }),
      ),
    }),
  },
  get_stock: {
    writes: false,
    description: "Stock and price of a product, optionally for one size and/or color.",
    input: z.strictObject({
      productId: idSchema,
      size: z.string().optional(),
      color: z.string().optional(),
    }),
    output: z.object({
      productId: idSchema,
      name: z.string(),
      price: vndSchema,
      variants: z.array(
        z.object({ variantId: idSchema, size: z.string(), color: z.string(), stock }),
      ),
    }),
  },
  recommend_size: {
    writes: false,
    description:
      "Size for this product from its size chart, given the shopper's height and weight.",
    input: z.strictObject({
      productId: idSchema,
      heightCm: z.int().min(50).max(250),
      weightKg: z.int().min(20).max(250),
    }),
    // When height and weight point to different sizes, `size` is the larger one
    // (PB-06, A1); both are returned so the reply can say why.
    output: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ok"),
        size: z.string(),
        sizeByHeight: z.string(),
        sizeByWeight: z.string(),
      }),
      z.object({ status: z.literal("out_of_range") }),
      z.object({ status: z.literal("no_chart") }),
    ]),
  },
  get_pairings: {
    writes: false,
    description:
      "Items the shop owner declared as going well with this product, in stock (in the given size when known).",
    input: z.strictObject({ productId: idSchema, size: z.string().optional() }),
    output: z.object({
      pairings: z.array(
        z.object({
          productId: idSchema,
          name: z.string(),
          price: vndSchema,
          imageUrl: z.string().nullable(),
          reason: z.string(),
          sizesInStock: sizes,
        }),
      ),
    }),
  },
  get_policy: {
    writes: false,
    description:
      "The shop's own text for returns (doi_tra), shipping (giao_hang) or promotions (khuyen_mai).",
    input: z.strictObject({ kind: policyKindSchema }),
    // null: the shop has no such policy (no row, or blank text in policies.content),
    // so the question goes to staff.
    output: z.object({ kind: policyKindSchema, content: z.string().nullable() }),
  },
  quote_order: {
    writes: false,
    description:
      "Unit prices, line totals and the order total for a list of items. Never do this arithmetic yourself.",
    input: z.strictObject({ items: orderItems }),
    output: z.object({
      lines: z.array(
        z.object({
          variantId: idSchema,
          productId: idSchema,
          name: z.string(),
          size: z.string(),
          color: z.string(),
          quantity: z.int().positive(),
          unitPrice: vndSchema,
          lineTotal: vndSchema,
        }),
      ),
      total: vndSchema,
    }),
  },
  create_draft_order: {
    writes: true,
    description:
      "Create a draft order after the shopper confirmed the summary. Stock does not change until staff confirm.",
    input: z.strictObject({
      items: orderItems,
      customerName: z.string().trim().min(1).max(100),
      customerPhone: z.string().regex(/^0\d{9}$/, "10 digits starting with 0"),
      customerAddress: z.string().trim().min(1).max(300),
    }),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("created"), orderId: idSchema, total: vndSchema }),
      z.object({ status: z.literal("out_of_stock"), variantIds: z.array(idSchema) }),
    ]),
  },
  handoff_to_staff: {
    writes: true,
    description:
      "Hand the conversation to staff; the AI stops replying until staff hand it back.",
    input: z.strictObject({
      reason: handoffReasonSchema.exclude(["postcheck_failed", "too_many_tool_calls"]),
    }),
    output: z.object({ mode: z.literal("needs_human") }),
  },
} as const;

export type ToolName = keyof typeof tools;
export type ToolInput<T extends ToolName> = z.infer<(typeof tools)[T]["input"]>;
export type ToolOutput<T extends ToolName> = z.infer<(typeof tools)[T]["output"]>;

const toolNames = Object.keys(tools) as ToolName[];

// staff_draft can't write: no draft orders, no handoff (PB-00, PB-20).
export function toolsForMode(mode: EngineMode): ToolName[] {
  return toolNames.filter((name) => mode === "customer" || !tools[name].writes);
}

// Tool definitions in the shape the Claude API takes (name, description, input_schema).
export function toolDefinitions(mode: EngineMode) {
  return toolsForMode(mode).map((name) => ({
    name,
    description: tools[name].description,
    input_schema: inputSchema(name),
  }));
}

function inputSchema(name: ToolName) {
  // $schema adds tokens to every turn and the API doesn't need it.
  const schema = z.toJSONSchema(tools[name].input, { io: "input" });
  delete schema.$schema;
  return schema;
}

// One entry of ai_turns.tool_calls (PB-03 writes it; PB-07 and PB-10 read it).
export const toolCallLogSchema = z.object({
  name: z.enum(Object.keys(tools) as [ToolName, ...ToolName[]]),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});
export type ToolCallLog = z.infer<typeof toolCallLogSchema>;
