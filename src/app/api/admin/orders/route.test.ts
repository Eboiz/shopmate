import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionResult, DraftOrderView } from "@/lib/orders/draft-orders";

// Route validation and status codes for the orders API (PB-12), and a check that
// the page's own client (orders-data.ts) accepts what the routes answer.

let signedIn = true;
vi.mock("@/lib/staff-api", () => ({
  staffSession: async () => (signedIn ? { db: "user-db", staff: { userId: "u1", shopId: "shop-a", role: "staff" } } : null),
}));

const ORDER = "a0000000-0000-4000-8000-000000000011";
const listed: DraftOrderView[] = [
  {
    id: ORDER,
    conversationId: "a0000000-0000-4000-8000-000000000031",
    createdAt: "2026-11-07T03:00:00.000+00:00",
    customer: { name: "Thảo", phone: "0912345678", address: "12 Lê Lợi, Q1" },
    items: [{ id: "a0000000-0000-4000-8000-000000000061", name: "Váy suông linen", size: "M", color: "be", quantity: 2, unitPrice: 350000 }],
    total: 700000,
  },
];
const listCalls: unknown[][] = [];
const decideCalls: unknown[][] = [];
let decision: DecisionResult = { status: "confirmed", notificationSent: true };
let failWith: Error | null = null;
vi.mock("@/lib/orders/draft-orders", () => ({
  listDraftOrders: async (...args: unknown[]) => {
    listCalls.push(args);
    if (failWith) throw failWith;
    return listed;
  },
  decideDraftOrder: async (...args: unknown[]) => {
    decideCalls.push(args);
    if (failWith) throw failWith;
    return decision;
  },
}));

const { GET } = await import("./route");
const { PATCH } = await import("./[id]/route");
const ordersData = await import("@/app/admin/orders/orders-data");

const get = (query: string) => GET(new NextRequest(`http://localhost/api/admin/orders${query}`));
const patch = (id: string, body: string) =>
  PATCH(
    new NextRequest(`http://localhost/api/admin/orders/${id}`, {
      method: "PATCH",
      body,
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  signedIn = true;
  decision = { status: "confirmed", notificationSent: true };
  failWith = null;
  listCalls.length = 0;
  decideCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/admin/orders", () => {
  it("lists the staff member's drafts, scoped to the shop of their session", async () => {
    const response = await get("?status=draft");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orders: listed });
    expect(listCalls).toEqual([["user-db", "shop-a"]]);
  });

  it.each(["", "?status=confirmed", "?status=draft&status=x"])("refuses the query %j", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(listCalls).toHaveLength(0);
  });

  it("ignores a shop id sent by the client", async () => {
    await get("?status=draft&shopId=b0000000-0000-4000-8000-000000000001");
    expect(listCalls).toEqual([["user-db", "shop-a"]]);
  });

  it("answers 401 when nobody is signed in", async () => {
    signedIn = false;
    const response = await get("?status=draft");
    expect(response.status).toBe(401);
    expect(listCalls).toHaveLength(0);
  });

  it("answers 500 when the database read fails", async () => {
    failWith = new Error("db down");
    expect((await get("?status=draft")).status).toBe(500);
  });
});

describe("PATCH /api/admin/orders/:id", () => {
  it.each(["confirmed", "cancelled"] as const)("passes %s to the database", async (status) => {
    const response = await patch(ORDER, JSON.stringify({ status }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, notificationSent: true });
    expect(decideCalls).toEqual([["user-db", ORDER, status]]);
  });

  it.each([
    ["a status that is not a decision", ORDER, JSON.stringify({ status: "draft" })],
    ["no status", ORDER, JSON.stringify({})],
    ["a body that is not JSON", ORDER, "status=confirmed"],
    ["an id that is not a uuid", "42", JSON.stringify({ status: "confirmed" })],
  ])("refuses %s with 400", async (_case, id, body) => {
    const response = await patch(id, body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/\p{L}/u);
    expect(decideCalls).toHaveLength(0);
  });

  it("answers 401 when nobody is signed in", async () => {
    signedIn = false;
    expect((await patch(ORDER, JSON.stringify({ status: "confirmed" }))).status).toBe(401);
    expect(decideCalls).toHaveLength(0);
  });

  it.each(["insufficient_stock", "not_draft"] as const)("answers 409 %s with a Vietnamese message", async (status) => {
    decision = { status };
    const response = await patch(ORDER, JSON.stringify({ status: "confirmed" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe(status);
    expect(body.message).toMatch(/đơn/i);
  });

  it("answers 404 for an order outside the staff member's shop", async () => {
    decision = { status: "not_found" };
    expect((await patch(ORDER, JSON.stringify({ status: "confirmed" }))).status).toBe(404);
  });

  it("reports a notification that was not sent without failing the request", async () => {
    decision = { status: "confirmed", notificationSent: false };
    const response = await patch(ORDER, JSON.stringify({ status: "confirmed" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, notificationSent: false });
  });

  it("answers 500 when the database call fails", async () => {
    failWith = new Error("db down");
    expect((await patch(ORDER, JSON.stringify({ status: "confirmed" }))).status).toBe(500);
  });
});

describe("the orders page client accepts these answers", () => {
  // Route each fetch from orders-data.ts to the real route handlers.
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const request = new NextRequest(new URL(url, "http://localhost"), init as ConstructorParameters<typeof NextRequest>[1]);
      if (request.method === "PATCH") {
        const id = decodeURIComponent(request.nextUrl.pathname.split("/").pop()!);
        return PATCH(request, { params: Promise.resolve({ id }) });
      }
      return GET(request);
    });
  });

  it("lists draft orders", async () => {
    expect(await ordersData.listDraftOrders()).toEqual(listed);
  });

  it("reads success, notification failure and both conflicts", async () => {
    expect(await ordersData.decideDraftOrder(ORDER, "confirmed")).toEqual({ ok: true, notificationSent: true });
    decision = { status: "cancelled", notificationSent: false };
    expect(await ordersData.decideDraftOrder(ORDER, "cancelled")).toEqual({ ok: true, notificationSent: false });
    decision = { status: "insufficient_stock" };
    expect(await ordersData.decideDraftOrder(ORDER, "confirmed")).toEqual({ ok: false, code: "insufficient_stock" });
    decision = { status: "not_draft" };
    expect(await ordersData.decideDraftOrder(ORDER, "confirmed")).toEqual({ ok: false, code: "not_draft" });
  });
});
