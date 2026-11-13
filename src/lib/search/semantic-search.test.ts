import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedderSearchRequestSchema } from "./embedder-contract";
import {
  SEARCH_TIMEOUT_MS,
  SemanticSearchUnavailable,
  httpSemanticSearch,
  semanticSearchFromEnv,
  type SemanticQuery,
} from "./semantic-search";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const responseOk = readFileSync(path.join(import.meta.dirname, "contract-fixtures", "response-ok.json"), "utf8");

const env = { EMBEDDER_URL: "https://embedder.example/", EMBEDDER_TOKEN: "secret" };

const query: SemanticQuery = { shopId: SHOP_ID, text: "váy dài màu be đi biển", photo: null, limit: 10 };

const loadDocs = async () => [
  {
    id: "22222222-2222-4222-8222-222222222201",
    name: "Váy suông linen",
    category: "vay",
    description: null,
    colors: ["Be"],
  },
];

// Next types every NODE_ENV as required; the adapter only reads the keys it needs.
const processEnv = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

function fakeFetch(respond: (init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(init);
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe("httpSemanticSearch", () => {
  it("posts the contract body with the bearer token", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(responseOk, { status: 200 }));
    const search = httpSemanticSearch(env, fetchImpl);
    await search(query);

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe("https://embedder.example/search");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");

    const body = JSON.parse(init?.body as string);
    expect(embedderSearchRequestSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty("imageBase64");
    expect(body).not.toHaveProperty("mediaType");
  });

  it("returns hits from a response-ok fixture", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(responseOk, { status: 200 }));
    const search = httpSemanticSearch(env, fetchImpl);

    await expect(search(query)).resolves.toEqual({ hits: JSON.parse(responseOk).hits, reranked: true });
  });

  it("reads reranked from the response, and a response without it as cosine scores", async () => {
    const plain = { ...JSON.parse(responseOk) };
    delete plain.reranked;
    for (const [body, reranked] of [
      [{ ...plain, reranked: false }, false],
      [plain, false],
    ] as const) {
      const search = httpSemanticSearch(env, fakeFetch(() => new Response(JSON.stringify(body), { status: 200 })).fetchImpl);
      await expect(search(query)).resolves.toMatchObject({ reranked });
    }
  });

  it("throws SemanticSearchUnavailable on non-2xx, invalid JSON and a body that fails the schema", async () => {
    const responses = [
      () => new Response("down", { status: 503 }),
      () => new Response("not json", { status: 200 }),
      () => new Response(JSON.stringify({ hits: [{ productId: "x" }] }), { status: 200 }),
    ];
    for (const respond of responses) {
      const search = httpSemanticSearch(env, fakeFetch(respond).fetchImpl);
      await expect(search(query)).rejects.toBeInstanceOf(SemanticSearchUnavailable);
    }
  });

  it("throws SemanticSearchUnavailable after SEARCH_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    try {
      // Resolves only when the adapter aborts the request, then rejects like fetch does.
      const hang = async (init?: RequestInit) => {
        await new Promise<void>((resolve) => init?.signal?.addEventListener("abort", () => resolve()));
        throw new Error("aborted");
      };
      const search = httpSemanticSearch(env, fakeFetch(hang).fetchImpl);

      let settled = false;
      const outcome = search(query)
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBeInstanceOf(SemanticSearchUnavailable);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("semanticSearchFromEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks mock, http or null", async () => {
    const mock = semanticSearchFromEnv(processEnv({ SEARCH_EMBEDDER_MOCK: "1" }), loadDocs);
    expect(mock).not.toBeNull();
    await expect(mock!({ ...query, text: "vay be" })).resolves.toEqual({
      hits: [{ productId: "22222222-2222-4222-8222-222222222201", score: 1 }],
      reranked: true,
    });

    const { fetchImpl, calls } = fakeFetch(() => new Response(responseOk, { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const http = semanticSearchFromEnv(processEnv(env), loadDocs);
    expect(http).not.toBeNull();
    await expect(http!(query)).resolves.toMatchObject({ hits: JSON.parse(responseOk).hits });
    expect(calls).toHaveLength(1);

    expect(semanticSearchFromEnv(processEnv({}), loadDocs)).toBeNull();
    expect(semanticSearchFromEnv(processEnv({ EMBEDDER_URL: "https://embedder.example" }), loadDocs)).toBeNull();
    expect(semanticSearchFromEnv(processEnv({ EMBEDDER_TOKEN: "secret" }), loadDocs)).toBeNull();
  });

  it("ignores the mock flag in production", async () => {
    expect(
      semanticSearchFromEnv(processEnv({ NODE_ENV: "production", SEARCH_EMBEDDER_MOCK: "1" }), loadDocs),
    ).toBeNull();

    const { fetchImpl, calls } = fakeFetch(() => new Response(responseOk, { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const search = semanticSearchFromEnv(
      processEnv({ ...env, NODE_ENV: "production", SEARCH_EMBEDDER_MOCK: "1" }),
      loadDocs,
    );
    expect(search).not.toBeNull();
    await expect(search!(query)).resolves.toMatchObject({ hits: JSON.parse(responseOk).hits });
    expect(calls).toHaveLength(1);
  });
});
