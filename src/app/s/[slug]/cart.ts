"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { formatPrice } from "@/lib/format";

// The order basket of the shop page. It never takes payment: it only gathers
// items so the shopper sends one order message in the chat, and the shop
// confirms it there as before. Kept per shop in this browser.

const cartItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number(),
  imageUrl: z.string().nullable(),
  color: z.string(),
  size: z.string(),
  quantity: z.number().int().min(1).max(99),
  // Stock when the line was added; older baskets have none and cap at 99.
  maxQuantity: z.number().int().min(1).max(99).optional(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

// The chat field takes one line of up to 1000 characters.
export const CART_MAX_LINES = 10;

// Lines are found by what they are, not by their place in the list: another
// tab can change the basket while this one is open.
export function cartLineKey(item: Pick<CartItem, "productId" | "color" | "size">): string {
  return [item.productId, item.color, item.size].join("|");
}

export function cartLineMax(item: CartItem): number {
  return item.maxQuantity ?? 99;
}

const storageKey = (slug: string) => `shopmate-cart:${slug}`;

// The stored JSON per shop. Blocked storage (private mode) falls back to
// memory, so the basket still works for this visit.
const memory = new Map<string, string>();
const CHANGE_EVENT = "shopmate-cart-change";

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? "[]";
  } catch {
    return memory.get(key) ?? "[]";
  }
}

function writeRaw(key: string, items: CartItem[]) {
  const raw = JSON.stringify(items);
  memory.set(key, raw);
  try {
    if (items.length) localStorage.setItem(key, raw);
    else localStorage.removeItem(key);
  } catch {
    // Kept in memory only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  // "storage" also keeps two open tabs of the shop in step.
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function parseItems(raw: string): CartItem[] {
  try {
    const parsed = z.array(cartItemSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, CART_MAX_LINES) : [];
  } catch {
    return [];
  }
}

export function useCart(slug: string) {
  const key = storageKey(slug);
  // The server and the first client render see an empty basket.
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => "[]");
  const items = useMemo(() => parseItems(raw), [raw]);
  const setItems = useCallback(
    (update: (current: CartItem[]) => CartItem[]) => writeRaw(key, update(parseItems(readRaw(key)))),
    [key],
  );

  // Adds the line, or raises its quantity up to the stock; false when the
  // basket is full.
  const add = useCallback((item: CartItem, maxQuantity = 99): boolean => {
    let added = true;
    const max = Math.max(1, Math.min(99, maxQuantity));
    const key = cartLineKey(item);
    setItems((current) => {
      const index = current.findIndex((line) => cartLineKey(line) === key);
      if (index >= 0) {
        return current.map((line, i) => (i === index ? { ...line, quantity: Math.min(max, line.quantity + item.quantity), maxQuantity: max } : line));
      }
      if (current.length >= CART_MAX_LINES) {
        added = false;
        return current;
      }
      return [...current, { ...item, quantity: Math.min(max, item.quantity), maxQuantity: max }];
    });
    return added;
  }, [setItems]);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setItems((current) => current.map((line) => (cartLineKey(line) === key ? { ...line, quantity: Math.max(1, Math.min(cartLineMax(line), quantity)) } : line)));
  }, [setItems]);

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((line) => cartLineKey(line) !== key));
  }, [setItems]);

  // Puts a removed line back where it was ("Hoàn tác"); false when the basket
  // filled up meanwhile.
  const restore = useCallback((item: CartItem, index: number): boolean => {
    let restored = true;
    setItems((current) => {
      if (current.some((line) => cartLineKey(line) === cartLineKey(item))) return current;
      if (current.length >= CART_MAX_LINES) {
        restored = false;
        return current;
      }
      return [...current.slice(0, index), item, ...current.slice(index)];
    });
    return restored;
  }, [setItems]);

  const clear = useCallback(() => setItems(() => []), [setItems]);

  return { items, add, setQuantity, remove, restore, clear };
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

// One line, so it fits the chat field: the AI and staff read every item and
// make one order waiting for the shop's confirmation.
export function cartMessage(items: CartItem[]): string {
  const lines = items.map((item, index) => {
    const details = [item.color && `màu ${item.color}`, item.size && `size ${item.size}`, `số lượng ${item.quantity}`].filter(Boolean).join(", ");
    return `(${index + 1}) ${item.name}, ${details}`;
  });
  return `Mình muốn đặt ${items.length} món: ${lines.join("; ")}. Tạm tính ${formatPrice(cartSubtotal(items))}. Shop xác nhận giúp mình nhé.`;
}
