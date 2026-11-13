import { describe, expect, it } from "vitest";
import {
  avatarInitial, customerLabel, foldSearch, formatListTime, initialOf,
} from "./inbox-filter";

describe("foldSearch", () => {
  it("drops case and Vietnamese diacritics, including đ", () => {
    expect(foldSearch("  Đức MINH Ánh ")).toBe("duc minh anh");
  });
});

describe("formatListTime", () => {
  const now = Date.parse("2026-11-07T10:00:00Z"); // 17:00 in Vietnam

  it("shows the time today, the day this year and the full date before", () => {
    expect(formatListTime("2026-11-07T02:05:00Z", now)).toBe("09:05");
    expect(formatListTime("2026-11-06T17:30:00Z", now)).toBe("00:30"); // already the 7th in Vietnam
    expect(formatListTime("2026-11-05T03:00:00Z", now)).toBe("5/11");
    expect(formatListTime("2025-11-05T03:00:00Z", now)).toBe("5/11/2025");
  });
});

describe("initialOf", () => {
  it("takes the given name's first letter", () => {
    expect(initialOf("Nguyễn Lân Ánh")).toBe("Á");
    expect(initialOf("Lê Bình (demo 013)")).toBe("B");
    expect(initialOf("  ")).toBe("?");
  });
});

describe("customerLabel", () => {
  it("keeps the name the shopper gave", () => {
    expect(customerLabel("  Lan Anh ", "web", "3f2a9c")).toBe("Lan Anh");
  });

  it("tells unnamed shoppers apart by channel and conversation", () => {
    expect(customerLabel(null, "messenger", "3f2a9c")).toBe("Khách Messenger #3F2A");
    expect(customerLabel("   ", "web", "b81d00")).toBe("Khách Web chat #B81D");
  });
});

describe("avatarInitial", () => {
  it("uses the given name, or the channel when the shopper has no name", () => {
    expect(avatarInitial({ customerName: "Nguyễn Thảo", channel: "web" })).toBe("T");
    expect(avatarInitial({ customerName: "Khách Telegram #AB12", channel: "telegram", unnamed: true })).toBe("T");
    expect(avatarInitial({ customerName: "Khách Web chat #AB12", channel: "messenger", unnamed: true })).toBe("M");
  });
});
