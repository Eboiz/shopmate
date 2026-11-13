import { describe, expect, it } from "vitest";
import { contactItems, displayUrl, shopContactSchema, telHref } from "./contact";

describe("shopContactSchema", () => {
  it("trims the fields and saves an empty one as null", () => {
    expect(shopContactSchema.parse({ address: "  12 Lê Lợi, Q1 ", phone: "", fanpageUrl: "   " })).toEqual({
      address: "12 Lê Lợi, Q1",
      phone: null,
      fanpageUrl: null,
    });
  });

  it("accepts Vietnamese phone formats", () => {
    for (const phone of ["0901234567", "0901 234 567", "+84 90 123 4567", "028.3822.1234", "(028) 3822-1234"]) {
      expect(shopContactSchema.safeParse({ address: "", phone, fanpageUrl: "" }).success, phone).toBe(true);
    }
  });

  it("refuses a phone with letters or too few digits", () => {
    for (const phone of ["090abc4567", "12345", "+84"]) {
      const result = shopContactSchema.safeParse({ address: "", phone, fanpageUrl: "" });
      expect(result.success, phone).toBe(false);
      expect(result.error?.issues[0].message).toMatch(/Số điện thoại/);
    }
  });

  it("wants an https fanpage link", () => {
    expect(shopContactSchema.safeParse({ address: "", phone: "", fanpageUrl: "https://facebook.com/may" }).success).toBe(true);
    for (const fanpageUrl of ["http://facebook.com/may", "facebook.com/may", "javascript:alert(1)", "https://localhost"]) {
      const result = shopContactSchema.safeParse({ address: "", phone: "", fanpageUrl });
      expect(result.success, fanpageUrl).toBe(false);
      expect(result.error?.issues[0].message).toMatch(/https:\/\//);
    }
  });

  it("caps the address length", () => {
    expect(shopContactSchema.safeParse({ address: "a".repeat(201), phone: "", fanpageUrl: "" }).success).toBe(false);
  });
});

describe("telHref", () => {
  it("keeps only digits and the leading +", () => {
    expect(telHref("0901 234 567")).toBe("tel:0901234567");
    expect(telHref("+84 (90) 123-4567")).toBe("tel:+84901234567");
  });
});

describe("displayUrl", () => {
  it("drops the protocol, www and the trailing slash", () => {
    expect(displayUrl("https://www.facebook.com/maybout/")).toBe("facebook.com/maybout");
  });
});

describe("contactItems", () => {
  it("lists only the fields that are filled in", () => {
    expect(contactItems({ address: "12 Lê Lợi", phone: null, fanpageUrl: " " })).toEqual([{ kind: "address", text: "12 Lê Lợi" }]);
    expect(contactItems(undefined)).toEqual([]);
  });

  it("links the phone with tel: and the fanpage with its URL", () => {
    expect(contactItems({ address: null, phone: "0901 234 567", fanpageUrl: "https://facebook.com/may" })).toEqual([
      { kind: "phone", text: "0901 234 567", href: "tel:0901234567" },
      { kind: "fanpage", text: "facebook.com/may", href: "https://facebook.com/may" },
    ]);
  });
});
