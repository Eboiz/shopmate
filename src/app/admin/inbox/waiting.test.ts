import { describe, expect, it } from "vitest";
import { formatWaiting, waitingMs } from "./waiting";

const minute = 60_000;

describe("formatWaiting", () => {
  it.each([
    [0, "vừa xong"],
    [59_000, "vừa xong"],
    [minute, "1 phút"],
    [59 * minute, "59 phút"],
    [60 * minute, "1 giờ"],
    [23 * 60 * minute + 59 * minute, "23 giờ"],
    [24 * 60 * minute, "1 ngày"],
    [29 * 24 * 60 * minute, "29 ngày"],
    [61 * 24 * 60 * minute, "2 tháng"],
  ])("%i ms -> %s", (ms, label) => {
    expect(formatWaiting(ms)).toBe(label);
  });
});

describe("waitingMs", () => {
  it("counts from the given time and never goes negative", () => {
    const now = Date.parse("2026-11-07T10:00:00Z");
    expect(waitingMs("2026-11-07T09:30:00Z", now)).toBe(30 * minute);
    expect(waitingMs("2026-11-07T10:05:00Z", now)).toBe(0);
  });
});
