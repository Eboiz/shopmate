import { describe, expect, it } from "vitest";
import { applyResult, searchLabel, type SearchState } from "./search-state";
import { searchErrors } from "./request";

const P1 = "11111111-1111-4111-8111-111111111111";
const loading: SearchState = { status: "loading", seq: 2, label: "Kết quả cho “váy be”" };

describe("applyResult", () => {
  it("semantic response becomes done with the ids", () => {
    expect(applyResult(loading, 2, { ok: true, body: { mode: "semantic", productIds: [P1] }, hasPhoto: false })).toEqual({
      status: "done",
      seq: 2,
      label: "Kết quả cho “váy be”",
      productIds: [P1],
    });
  });

  it("an empty semantic response is done with no ids (the empty state shows)", () => {
    const next = applyResult(loading, 2, { ok: true, body: { mode: "semantic", productIds: [] }, hasPhoto: true });
    expect(next).toMatchObject({ status: "done", productIds: [] });
  });

  it("ignores a response whose seq is not the latest", () => {
    expect(applyResult(loading, 1, { ok: true, body: { mode: "semantic", productIds: [P1] }, hasPhoto: false })).toBe(loading);
    const idle: SearchState = { status: "idle" };
    expect(applyResult(idle, 2, { ok: false, message: "x" })).toBe(idle);
  });

  it("unavailable text search goes back to idle", () => {
    expect(applyResult(loading, 2, { ok: true, body: { mode: "unavailable" }, hasPhoto: false })).toEqual({ status: "idle" });
  });

  it("unavailable photo search shows photoUnavailable", () => {
    expect(applyResult(loading, 2, { ok: true, body: { mode: "unavailable" }, hasPhoto: true })).toEqual({
      status: "error",
      message: searchErrors.photoUnavailable,
    });
  });

  it("failed request shows its message", () => {
    expect(applyResult(loading, 2, { ok: false, message: searchErrors.rateLimited })).toEqual({
      status: "error",
      message: searchErrors.rateLimited,
    });
  });
});

describe("searchLabel", () => {
  it("names the text, a photo alone, or both", () => {
    expect(searchLabel("  váy be ", false)).toBe("Kết quả cho “váy be”");
    expect(searchLabel("", true)).toBe("Kết quả tìm bằng ảnh");
    expect(searchLabel("màu đỏ", true)).toBe("Kết quả cho “màu đỏ”");
  });
});
