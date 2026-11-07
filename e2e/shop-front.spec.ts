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

  // Asking about a product starts from its detail page.
  await page.getByRole("link", { name: "Xem chi tiết", exact: true }).click();
  await expect(page).toHaveURL(`/s/may-boutique/p/${productId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Váy hoa");
  await page.getByRole("button", { name: "Hỏi shop", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  await expect(chat.getByText("Đang hỏi về:")).toContainText("Váy hoa");
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill("Váy này còn size M không?");
  await chat.getByRole("button", { name: "Gửi" }).click();
  await expect(chat.getByRole("status")).toContainText("Shop đang trả lời");
  await expect(page.getByText("Váy hoa còn size M.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem màu Be" })).toBeVisible();
  expect(submitted[0]?.productId).toBe(productId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.reload();
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
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
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
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
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Tin nhắn" }).fill("Tư vấn giúp mình");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByText("Trợ lý đang bận. Vui lòng thử lại.")).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(page.getByText("Trợ lý đang bận. Vui lòng thử lại.")).toBeVisible();
});

test("keeps the reply indicator until the answer arrives", async ({ page }) => {
  const messages: Array<Record<string, unknown>> = [];
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() === "POST") {
      messages.push({ id: "55555555-5555-4555-8555-555555555555", sender: "shopper", text: "Còn hàng không?", reply: null, createdAt: new Date().toISOString() });
      await route.fulfill({ json: { messages } });
      return;
    }
    await route.fulfill({ json: { messages } });
  });

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Tin nhắn" }).fill("Còn hàng không?");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByRole("status")).toContainText("Shop đang trả lời");
  await expect(page.getByText("Còn hàng không?", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Shop đang trả lời");

  messages.push({ id: "66666666-6666-4666-8666-666666666666", sender: "ai", text: "Còn hàng ạ.", reply: null, createdAt: new Date().toISOString() });
  await expect(page.getByText("Còn hàng ạ.")).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("reuses message id on retry and shows a Vietnamese network error", async ({ page }) => {
  const submitted: Array<Record<string, unknown>> = [];
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() === "POST") {
      submitted.push(route.request().postDataJSON() as Record<string, unknown>);
      if (submitted.length === 1) await route.abort("failed");
      else await route.fulfill({ json: { messages: [] } });
      return;
    }
    await route.fulfill({ json: { messages: [] } });
  });

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Tin nhắn" }).fill("Tư vấn giúp mình");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByText("Chưa gửi được tin nhắn. Vui lòng kiểm tra kết nối và thử lại.")).toBeVisible();
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1]?.clientMessageId).toBe(submitted[0]?.clientMessageId);
});

test("a delayed old poll cannot erase a newer answer", async ({ page }) => {
  let reads = 0;
  let answerReady = false;
  let releaseOldPoll = () => {};
  const oldPoll = new Promise<void>((resolve) => { releaseOldPoll = resolve; });
  let oldPollStarted = () => {};
  const pollStarted = new Promise<void>((resolve) => { oldPollStarted = resolve; });
  const answer = { id: "77777777-7777-4777-8777-777777777777", sender: "ai", text: "Còn hàng ạ.", reply: null, createdAt: new Date().toISOString() };
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() === "POST") {
      answerReady = true;
      await route.fulfill({ json: { messages: [answer] } });
      return;
    }
    reads += 1;
    if (reads === 2) {
      oldPollStarted();
      await oldPoll;
      await route.fulfill({ json: { messages: [] } });
      return;
    }
    await route.fulfill({ json: { messages: answerReady ? [answer] : [] } });
  });

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  await pollStarted;
  await page.getByRole("textbox", { name: "Tin nhắn" }).fill("Còn hàng không?");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByText("Còn hàng ạ.")).toBeVisible();
  releaseOldPoll();
  await expect(page.getByText("Còn hàng ạ.")).toBeVisible();
});
