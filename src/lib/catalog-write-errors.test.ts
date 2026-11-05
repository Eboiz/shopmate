import { describe, expect, it } from "vitest";
import {
  NOT_ALLOWED,
  NOT_FOUND,
  PAIRING_EXISTS,
  SAVE_FAILED,
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
    ["23505", PAIRING_EXISTS],
    ["23503", NOT_FOUND],
    ["08006", SAVE_FAILED],
    [undefined, SAVE_FAILED],
  ])("maps error code %j", (code, message) => {
    expect(writeErrorMessage({ code }, 0)).toBe(message);
  });
});
