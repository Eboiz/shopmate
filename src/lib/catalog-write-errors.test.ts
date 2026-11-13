import { describe, expect, it } from "vitest";
import {
  NOT_ALLOWED,
  NOT_FOUND,
  PAIRING_EXISTS,
  POLICY_SAVE_FAILED,
  SAVE_FAILED,
  SIZE_OVERLAP,
  writeErrorMessage,
} from "./catalog-write-errors";

describe("writeErrorMessage", () => {
  it("returns null when a row was changed", () => {
    expect(writeErrorMessage(null, 1)).toBeNull();
  });

  it("treats a write that matched no row as not found (RLS hides the row)", () => {
    expect(writeErrorMessage(null, 0)).toBe(NOT_FOUND);
  });

  it.each([
    ["42501", NOT_ALLOWED],
    ["23503", NOT_FOUND],
    ["P0002", NOT_FOUND],
    ["08006", SAVE_FAILED],
    [undefined, SAVE_FAILED],
  ])("maps error code %j", (code, message) => {
    expect(writeErrorMessage({ code }, 0)).toBe(message);
  });

  it("explains overlapping size ranges only for the size chart write (PB-24)", () => {
    expect(writeErrorMessage({ code: "23P01" }, 0, { overlap: SIZE_OVERLAP })).toBe(SIZE_OVERLAP);
    expect(writeErrorMessage({ code: "23P01" }, 0)).toBe(SAVE_FAILED);
  });

  it("says a pairing already exists only for the pairing write", () => {
    expect(writeErrorMessage({ code: "23505" }, 0, { duplicate: PAIRING_EXISTS })).toBe(PAIRING_EXISTS);
  });

  it("never shows the pairing message for a policy save (review #8)", () => {
    const policy = { failed: POLICY_SAVE_FAILED };
    expect(writeErrorMessage({ code: "23505" }, 0, policy)).toBe(POLICY_SAVE_FAILED);
    expect(writeErrorMessage({ code: "08006" }, 0, policy)).toBe(POLICY_SAVE_FAILED);
  });

  it("falls back to the generic message for a duplicate when the write names none", () => {
    expect(writeErrorMessage({ code: "23505" }, 0)).toBe(SAVE_FAILED);
  });
});
