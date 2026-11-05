import { expect, test } from "@playwright/test";

const productId = "11111111-1111-4111-8111-111111111111";
const catalog = {
  shop: { name: "Mây Boutique" },
  products: [{
    id: productId,
    name: "Váy hoa",
    price: 350000,
    imageUrl: null,
    colors: ["Be", "Xanh"],
    sizesInStock: ["S", "M"],
  }],
};

test("shop page and chat fit 375 px, send product context and restore history", async ({ page }) => {
  const messages: Array<Record<string, unknown>> = [];
  const submitted: Array<Record<string, unknown>> = [];
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      submitted.push(body);
      await new Promise((resolve) => setTimeout(resolve, 200));
      messages.push({
        id: "22222222-2222-4222-8222-222222222222",
        sender: "shopper",
        text: body.text,
        reply: null,
        createdAt: new Date().toISOString(),
      });
      messages.push({
        id: "33333333-3333-4333-8333-333333333333",
        sender: "ai",
        text: "Váy hoa còn size M.",
        reply: {
          text: "Váy hoa còn size M.",
          products: [{ productId, name: "Váy hoa", price: 350000, imageUrl: null, sizesInStock: ["S", "M"] }],
          quickReplies: ["Xem màu Be"],
        },
        createdAt: new Date().toISOString(),
      });
      await route.fulfill({ json: { messages } });
      return;
    }
    await route.fulfill({ json: { messages } });
  });

  await page.goto("/s/may-boutique");
  await expect(page.getByRole("heading", { name: "Mây Boutique" })).toBeVisible();
  await expect(page.getByText("Màu: Be, Xanh")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.getByRole("button", { name: "Hỏi về món này" }).click();
  await expect(page.getByText("Đang hỏi về:")).toContainText("Váy hoa");
  await page.getByRole("textbox", { name: "Tin nhắn" }).fill("Váy này còn size M không?");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByRole("status")).toContainText("Shop đang trả lời");
  await expect(page.getByText("Váy hoa còn size M.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem màu Be" })).toBeVisible();
  expect(submitted[0]?.productId).toBe(productId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.reload();
  await page.getByRole("button", { name: "Mở trò chuyện với shop" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Váy này còn size M không?")).toBeVisible();
});

test("open chat shows a staff reply from the next server poll", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", (route) => {
    reads += 1;
    return route.fulfill({ json: { messages: reads >= 2 ? [{
      id: "44444444-4444-4444-8444-444444444444",
      sender: "staff",
      text: "Shop đã kiểm tra tồn kho cho bạn.",
      reply: null,
      createdAt: new Date().toISOString(),
    }] : [] } });
  });

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Mở trò chuyện với shop" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Shop đã kiểm tra tồn kho cho bạn.")).toBeVisible({ timeout: 7000 });
});

test("a send error remains visible while history polling succeeds", async ({ page }) => {
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: "Trợ lý đang bận. Vui lòng thử lại." } })
      : route.fulfill({ json: { messages: [] } }),
  );

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Mở trò chuyện với shop" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Tin nhắn" }).fill("Tư vấn giúp mình");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByText("Trợ lý đang bận. Vui lòng thử lại.")).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(page.getByText("Trợ lý đang bận. Vui lòng thử lại.")).toBeVisible();
});
