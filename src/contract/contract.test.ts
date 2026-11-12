import { describe, expect, it } from "vitest";
import {
  conversationModeSchema,
  engineInputSchema,
  engineOutputSchema,
  gapQuestionSchema,
  gapTopicProposalSchema,
  hasBlank,
  learnResultSchema,
  modelReplySchema,
  replySchema,
  toolDefinitions,
  tools,
  toolsForMode,
} from "@/contract";

const id = "3f2b9c1e-8a4d-4f6b-9c2a-1d5e7f8a9b0c";

describe("tools", () => {
  it("defines exactly the 8 tools of the contract", () => {
    expect(Object.keys(tools).sort()).toEqual(
      [
        "create_draft_order",
        "get_pairings",
        "get_policy",
        "get_stock",
        "handoff_to_staff",
        "quote_order",
        "recommend_size",
        "search_products",
      ].sort(),
    );
  });

  it("marks only create_draft_order and handoff_to_staff as writing data", () => {
    const writers = Object.entries(tools)
      .filter(([, tool]) => tool.writes)
      .map(([name]) => name);
    expect(writers.sort()).toEqual(["create_draft_order", "handoff_to_staff"]);
  });

  it("never shows shop_id to the model, and rejects unknown keys", () => {
    for (const def of toolDefinitions("customer")) {
      expect(JSON.stringify(def.input_schema)).not.toMatch(/shop_?id/i);
      expect(def.input_schema).toMatchObject({ type: "object", additionalProperties: false });
    }
    const parsed = tools.search_products.input.safeParse({
      query: "váy",
      shop_id: id,
    });
    expect(parsed.success).toBe(false);
  });

  it("leaves create_draft_order and handoff_to_staff out of staff_draft mode", () => {
    expect(toolsForMode("customer")).toHaveLength(8);
    expect(toolsForMode("staff_draft")).not.toContain("create_draft_order");
    expect(toolsForMode("staff_draft")).not.toContain("handoff_to_staff");
    expect(toolDefinitions("staff_draft").map((d) => d.name)).toEqual(
      toolsForMode("staff_draft"),
    );
  });

  it("sends no $schema key to the model", () => {
    for (const def of toolDefinitions("customer")) expect(def.input_schema).not.toHaveProperty("$schema");
  });

  it("marks defaulted inputs as optional for the model", () => {
    const schema = toolDefinitions("customer").find((d) => d.name === "search_products")!
      .input_schema as { required?: string[] };
    expect(schema.required).toEqual(["query"]);
  });

  it("quote_order takes a list of items and returns unit prices, line totals and the total", () => {
    expect(
      tools.quote_order.input.safeParse({ items: [{ variantId: id, quantity: 2 }] }).success,
    ).toBe(true);
    expect(tools.quote_order.input.safeParse({ items: [] }).success).toBe(false);
    const quote = tools.quote_order.output.parse({
      lines: [
        {
          variantId: id,
          productId: id,
          name: "Váy suông linen",
          size: "M",
          color: "be",
          quantity: 2,
          unitPrice: 350000,
          lineTotal: 700000,
        },
      ],
      total: 700000,
    });
    expect(quote.total).toBe(700000);
  });

  it("rejects prices that are not whole đồng", () => {
    const result = tools.get_stock.output.safeParse({
      productId: id,
      name: "Váy",
      price: 349999.5,
      variants: [],
    });
    expect(result.success).toBe(false);
  });

  it("create_draft_order needs a Vietnamese mobile number and takes no price", () => {
    const order = {
      items: [{ variantId: id, quantity: 1 }],
      customerName: "Thảo",
      customerAddress: "12 Lê Lợi, Q1",
    };
    expect(
      tools.create_draft_order.input.safeParse({ ...order, customerPhone: "0912345678" }).success,
    ).toBe(true);
    expect(
      tools.create_draft_order.input.safeParse({ ...order, customerPhone: "912345678" }).success,
    ).toBe(false);
    expect(
      tools.create_draft_order.input.safeParse({
        ...order,
        customerPhone: "0912345678",
        items: [{ variantId: id, quantity: 1, unitPrice: 1 }],
      }).success,
    ).toBe(false);
  });

  it("recommend_size can say the shopper is out of the chart", () => {
    expect(tools.recommend_size.output.parse({ status: "out_of_range" })).toEqual({
      status: "out_of_range",
    });
  });

  it("handoff_to_staff reasons exclude the server-only ones", () => {
    expect(
      tools.handoff_to_staff.input.safeParse({ reason: "postcheck_failed" }).success,
    ).toBe(false);
    expect(tools.handoff_to_staff.input.safeParse({ reason: "complaint" }).success).toBe(true);
  });
});

describe("conversation mode", () => {
  it("is ai, needs_human or staff", () => {
    expect(conversationModeSchema.options).toEqual(["ai", "needs_human", "staff"]);
  });
});

describe("reply shape", () => {
  it("parses the PB-07 fallback card: no text, one product card", () => {
    const reply = replySchema.parse({
      text: "",
      products: [
        { productId: id, name: "Váy suông linen", price: 350000, imageUrl: null, sizesInStock: ["M"] },
      ],
      quickReplies: [],
    });
    expect(reply.products[0].price).toBe(350000);
  });

  it("limits quick replies to 20 characters", () => {
    const parsed = replySchema.safeParse({
      text: "Bạn chọn size nào?",
      products: [],
      quickReplies: ["Size M nhưng màu đen nhé bạn"],
    });
    expect(parsed.success).toBe(false);
  });

  it("the model returns product IDs, not cards with prices", () => {
    expect(modelReplySchema.shape).not.toHaveProperty("products");
    expect(modelReplySchema.parse({ text: "Còn ạ", productIds: [id], quickReplies: [] })).toEqual(
      { text: "Còn ạ", productIds: [id], quickReplies: [] },
    );
  });
});

describe("engine input and output", () => {
  const history = [{ sender: "shopper" as const, text: "váy này còn size M không?" }];

  it("customer mode reads the shop from the conversation, never the body", () => {
    expect(engineInputSchema.safeParse({ mode: "customer", conversationId: id, history }).success).toBe(true);
    expect(engineInputSchema.safeParse({ mode: "customer", shopId: id, history }).success).toBe(false);
  });

  it("staff_draft takes no shop from the body; the server resolves it from the staff profile", () => {
    expect(engineInputSchema.safeParse({ mode: "staff_draft", history }).success).toBe(true);
    // strictObject: a forged shopId is a parse error, so no path can build an
    // engine input that trusts a client-supplied shop.
    expect(engineInputSchema.safeParse({ mode: "staff_draft", shopId: id, history }).success).toBe(false);
  });

  it("returns the reply plus the personal-reply flag", () => {
    expect(
      engineOutputSchema.safeParse({
        reply: { text: "Dạ còn ạ", products: [], quickReplies: [] },
        personalReplyNeeded: false,
      }).success,
    ).toBe(true);
  });
});

describe("learning contract", () => {
  it("accepts a learned rule", () => {
    expect(() =>
      learnResultSchema.parse({
        status: "learn",
        policyKind: "giao_hang",
        rule: "Shop cho kiểm hàng trước khi nhận.",
        evidence: "shop có cho kiểm hàng",
        needsReview: false,
        reviewReasons: [],
        reason: "",
      }),
    ).not.toThrow();
  });

  it("accepts a skip with a known reason only", () => {
    expect(learnResultSchema.safeParse({ status: "skip", skipReason: "one_off", reason: "" }).success).toBe(true);
    expect(learnResultSchema.safeParse({ status: "skip", skipReason: "maybe", reason: "" }).success).toBe(false);
  });

  it("rejects a topic from fewer than 2 conversations", () => {
    expect(
      gapTopicProposalSchema.safeParse({
        title: "Kiểm hàng",
        policyKind: "giao_hang",
        questionIds: [id],
        conversationCount: 1,
        sampleQuestions: ["Kiểm hàng được không?"],
        draft: "Shop [có/không] cho kiểm hàng.",
      }).success,
    ).toBe(false);
  });

  it("caps a gap question at 500 characters", () => {
    expect(
      gapQuestionSchema.safeParse({ id, conversationId: id, reason: "policy_not_covered", question: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it("hasBlank finds [...] blanks", () => {
    expect(hasBlank("Shop [có/không] cho kiểm hàng.")).toBe(true);
    expect(hasBlank("Shop có cho kiểm hàng.")).toBe(false);
    expect(hasBlank("[]")).toBe(true);
  });
});
