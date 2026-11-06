import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { modelReplySchema } from "@/contract";
import { FALLBACK_TEXT, MODEL_REPLY_JSON_SCHEMA, parseModelReply } from "./model-reply";

const UNSUPPORTED = ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "multipleOf"];

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

describe("MODEL_REPLY_JSON_SCHEMA", () => {
  it("has no unsupported keywords", () => {
    expect(MODEL_REPLY_JSON_SCHEMA).not.toHaveProperty("$schema");
    walk(MODEL_REPLY_JSON_SCHEMA, (obj) => {
      for (const key of UNSUPPORTED) expect(obj, key).not.toHaveProperty(key);
      if (obj.type === "object") {
        expect(obj.additionalProperties).toBe(false);
        expect(obj.required).toEqual(Object.keys(obj.properties as object));
      }
    });
    // The contract schema itself keeps its limits.
    expect(modelReplySchema.safeParse({ text: "x".repeat(1001), productIds: [], quickReplies: [] }).success).toBe(false);
  });
});

describe("parseModelReply", () => {
  const id = randomUUID();
  const reply = { text: "Dạ còn ạ", productIds: [id], quickReplies: ["Xem váy"] };

  it("reads valid JSON", () => {
    expect(parseModelReply(JSON.stringify(reply))).toEqual({ reply, ok: true });
  });

  it("reads JSON inside a code fence", () => {
    expect(parseModelReply("```json\n" + JSON.stringify(reply) + "\n```")).toEqual({ reply, ok: true });
  });

  it("cuts long text", () => {
    const { reply: r, ok } = parseModelReply(JSON.stringify({ ...reply, text: "a".repeat(1500) }));
    expect(ok).toBe(true);
    expect(r.text).toHaveLength(1000);
  });

  it("drops bad quick replies and keeps at most 10", () => {
    const long = "x".repeat(25);
    const many = Array.from({ length: 12 }, (_, i) => `QR ${i}`);
    expect(parseModelReply(JSON.stringify({ ...reply, quickReplies: [long, "Ok"] })).reply.quickReplies).toEqual(["Ok"]);
    expect(parseModelReply(JSON.stringify({ ...reply, quickReplies: many })).reply.quickReplies).toEqual(many.slice(0, 10));
  });

  it("keeps valid, distinct product ids", () => {
    expect(parseModelReply(JSON.stringify({ ...reply, productIds: ["x", id, id] })).reply.productIds).toEqual([id]);
  });

  it("falls back on anything else", () => {
    for (const raw of ["không phải json", JSON.stringify({ ...reply, text: "" }), JSON.stringify({ text: 3 }), "{"]) {
      expect(parseModelReply(raw)).toEqual({
        reply: { text: FALLBACK_TEXT, productIds: [], quickReplies: [] },
        ok: false,
      });
    }
  });

  it("always matches the contract", () => {
    for (const raw of [JSON.stringify(reply), "x", JSON.stringify({ text: "a".repeat(2000), productIds: "no", quickReplies: [1] })]) {
      expect(() => modelReplySchema.parse(parseModelReply(raw).reply)).not.toThrow();
    }
  });
});
