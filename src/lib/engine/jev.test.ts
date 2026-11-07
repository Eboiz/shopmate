import { describe, expect, it, vi } from "vitest";
import {
  buildJevRequest,
  createJevClient,
  decideTurn,
  INTENTS,
  jevFromEnv,
  JEV_DEFAULT_MODEL,
  parseJevResponse,
  type CatalogItem,
  type JevResponse,
} from "./jev";

const catalog: CatalogItem[] = [
  { id: "id-vay", name: "Váy suông linen", category: "Váy", colors: ["Be", "Trắng"], sizes: ["S", "M"] },
  { id: "id-ao", name: "Áo khoác jean", category: null, colors: ["Xanh"], sizes: ["M"] },
];
const history = [
  { sender: "shopper" as const, text: "chào shop" },
  { sender: "ai" as const, text: "Dạ chào bạn" },
  { sender: "system" as const, text: "notice" },
  { sender: "shopper" as const, text: "váy này màu be size M còn không" },
];

const answers = (over: Partial<JevResponse["answers"]> = {}): JevResponse => ({
  model: "typesafe/jev-1.13-20260917",
  answers: {
    intent: { type: "choice", choice: "stock", confidence: 0.97 },
    product: { type: "choice", choice: "p1" },
    policy_kind: { type: "choice", choice: "giao_hang" },
    discount_trick: { type: "noul", noul: 0.02 },
    asked_to_clarify: { type: "noul", noul: 0.1 },
    ...over,
  },
  usage: { cost: 0.00003 },
});

describe("buildJevRequest", () => {
  it("sends the recent conversation, the viewed product and every intent; products as p1..pN", () => {
    const { request, productKeys } = buildJevRequest({ model: "m", history, viewing: { name: "Váy suông linen" }, catalog });
    const state = request.state as { conversation: { from: string; text: string }[]; viewingProduct: string };
    expect(state.conversation).toEqual([
      { from: "shopper", text: "chào shop" },
      { from: "assistant", text: "Dạ chào bạn" },
      { from: "shopper", text: "váy này màu be size M còn không" },
    ]);
    expect(state.viewingProduct).toBe("Váy suông linen");
    const intent = request.questions.intent as { type: string; criteria: Record<string, string> };
    expect(intent.type).toBe("choice");
    expect(Object.keys(intent.criteria)).toEqual([...INTENTS]);
    const product = request.questions.product as { criteria: Record<string, string> };
    expect(Object.keys(product.criteria)).toEqual(["p1", "p2", "viewing", "none"]);
    expect(product.criteria.p1).toBe("Váy suông linen (Váy)");
    expect(product.criteria.p2).toBe("Áo khoác jean");
    expect(productKeys.get("p2")).toBe("id-ao");
    expect(request.questions.discount_trick.type).toBe("noul");
    // ids never go to Jev
    expect(JSON.stringify(request)).not.toContain("id-vay");
  });

  it("has no 'viewing' option when no product is on screen, and keeps only the last 10 messages", () => {
    const long = Array.from({ length: 15 }, (_, i) => ({ sender: "shopper" as const, text: `m${i}` }));
    const { request } = buildJevRequest({ model: "m", history: long, viewing: null, catalog: [] });
    expect(Object.keys((request.questions.product as { criteria: object }).criteria)).toEqual(["none"]);
    const conv = (request.state as { conversation: { text: string }[] }).conversation;
    expect(conv).toHaveLength(10);
    expect(conv[0].text).toBe("m5");
  });
});

describe("parseJevResponse", () => {
  const keys = new Map([["p1", "id-vay"]]);
  const meta = { model: "m", ms: 500 };

  it("maps the answers to a decision", () => {
    expect(parseJevResponse(answers(), keys, meta)).toEqual({
      model: "typesafe/jev-1.13-20260917",
      intent: "stock",
      confidence: 0.97,
      product: { kind: "catalog", id: "id-vay" },
      policyKind: "giao_hang",
      discountTrick: 0.02,
      askedToClarify: 0.1,
      ms: 500,
      cost: 0.00003,
    });
  });

  it("reads 'viewing' and 'none', and a missing confidence as null", () => {
    const viewing = parseJevResponse(answers({ product: { type: "choice", choice: "viewing" }, intent: { type: "choice", choice: "size" } }), keys, meta);
    expect(viewing.product).toEqual({ kind: "viewing" });
    expect(viewing.confidence).toBeNull();
    expect(parseJevResponse(answers({ product: { type: "choice", choice: "none" } }), keys, meta).product).toEqual({ kind: "none" });
  });

  it("throws on an unknown intent or a missing answer", () => {
    expect(() => parseJevResponse(answers({ intent: { type: "choice", choice: "dance" } }), keys, meta)).toThrow("unknown intent");
    const missing = answers();
    delete (missing.answers as Record<string, unknown>).discount_trick;
    expect(() => parseJevResponse(missing, keys, meta)).toThrow("discount_trick");
  });
});

describe("Jev client", () => {
  it("posts the request with the bearer key and returns the JSON", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(answers()), { status: 200 }));
    const jev = createJevClient({ apiKey: "k", url: "https://x/decisions", fetch });
    const decision = await decideTurn(jev, { history, viewing: null, catalog, now: () => 0 });
    expect(decision.intent).toBe("stock");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x/decisions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(String(init.body)).model).toBe(JEV_DEFAULT_MODEL);
  });

  it("throws on an HTTP error", async () => {
    const fetch = vi.fn(async () => new Response("bad", { status: 402 }));
    const jev = createJevClient({ apiKey: "k", fetch });
    await expect(decideTurn(jev, { history, viewing: null, catalog, now: () => 0 })).rejects.toThrow("HTTP 402");
  });

  it("is off without a key, and under vitest unless asked", () => {
    expect(jevFromEnv({})).toBeNull();
    expect(jevFromEnv({ OPENROUTER_API_KEY: "k", VITEST: "true" })).toBeNull();
    expect(jevFromEnv({ OPENROUTER_API_KEY: "k", VITEST: "true", JEV_IN_TESTS: "true" })?.model).toBe(JEV_DEFAULT_MODEL);
    expect(jevFromEnv({ OPENROUTER_API_KEY: "k", JEV_MODEL: "typesafe/jev-latest" })?.model).toBe("typesafe/jev-latest");
  });
});
