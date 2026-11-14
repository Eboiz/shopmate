import { z } from "zod";

// The shop's contact details (PB-32): what the owner types in /admin and how
// the shop page footer shows it. Pure, so the form and the page share the rules.

// Same rules as the shops_*_check constraints in the database.
export const MAX_ADDRESS = 200;
export const MAX_FANPAGE_URL = 500;
const PHONE = /^\+?[0-9(][0-9 .()-]{6,18}[0-9]$/;

// An empty field means "not given" and is saved as null.
const optionalText = (schema: z.ZodString) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(schema.nullable());

export const shopContactSchema = z.object({
  address: optionalText(z.string().max(MAX_ADDRESS, `Địa chỉ tối đa ${MAX_ADDRESS} ký tự`)),
  phone: optionalText(z.string().regex(PHONE, "Số điện thoại chỉ gồm chữ số, dấu cách, dấu chấm hoặc gạch, ví dụ 0901 234 567")),
  fanpageUrl: optionalText(
    z
      .string()
      .max(MAX_FANPAGE_URL, `Link fanpage tối đa ${MAX_FANPAGE_URL} ký tự`)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !/\s/.test(value) && url.hostname.includes(".");
        } catch {
          return false;
        }
      }, "Link fanpage phải bắt đầu bằng https://, ví dụ https://facebook.com/tenshop"),
  ),
});

export type ShopContact = { address: string | null; phone: string | null; fanpageUrl: string | null };

// "0901 234 567" → "tel:0901234567"; "+84 (90) 123-4567" → "tel:+84901234567".
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// "https://www.facebook.com/maybout/" → "facebook.com/maybout", for the link text.
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

// The footer's contact lines, without the fields left empty.
export function contactItems(contact: Partial<ShopContact> | undefined) {
  const items: Array<
    { kind: "address"; text: string } | { kind: "phone"; text: string; href: string } | { kind: "fanpage"; text: string; href: string }
  > = [];
  const address = contact?.address?.trim();
  const phone = contact?.phone?.trim();
  const fanpage = contact?.fanpageUrl?.trim();
  if (address) items.push({ kind: "address", text: address });
  if (phone) items.push({ kind: "phone", text: phone, href: telHref(phone) });
  if (fanpage) items.push({ kind: "fanpage", text: displayUrl(fanpage), href: fanpage });
  return items;
}
