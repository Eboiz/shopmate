import { expect, test, type Locator } from "@playwright/test";

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
  await expect(page.getByText("2 màu · S–M")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Asking about a product starts from its detail page.
  await page.getByRole("link", { name: "Váy hoa", exact: true }).click();
  await expect(page).toHaveURL(`/s/may-boutique/p/${productId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Váy hoa");
  await page.getByRole("button", { name: "Hỏi shop", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  await expect(chat.getByText("Đang hỏi về:")).toContainText("Váy hoa");
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill("Váy này còn size M không?");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
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
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
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
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Shop đang trả lời");
  await expect(page.getByText("Còn hàng không?", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Shop đang trả lời");

  messages.push({ id: "66666666-6666-4666-8666-666666666666", sender: "ai", text: "Còn hàng ạ.", reply: null, createdAt: new Date().toISOString() });
  await expect(page.getByText("Còn hàng ạ.")).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("status")).toHaveCount(0);
});

// A 1×1 PNG, enough for the photo picker to accept and shrink.
const pixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a photo sent with text moves into the sending bubble at once", async ({ page }) => {
  const messages: Array<Record<string, unknown>> = [];
  let answer: () => void = () => {};
  const answered = new Promise<void>((resolve) => { answer = resolve; });
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() === "POST") {
      await answered;
      messages.push({ id: "99999999-9999-4999-8999-999999999999", sender: "shopper", text: "có áo này k", reply: null, createdAt: new Date().toISOString() });
      await route.fulfill({ json: { messages } });
      return;
    }
    await route.fulfill({ json: { messages } });
  });

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  await chat.locator('input[type="file"]').setInputFiles({ name: "ao.png", mimeType: "image/png", buffer: pixelPng });
  await expect(chat.getByRole("img", { name: "Ảnh sắp gửi" })).toBeVisible();
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill("có áo này k");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();

  // While the server is still answering, the photo is in the bubble with the text,
  // and no longer above the message field.
  await expect(chat.getByRole("img", { name: "Ảnh đang gửi" })).toBeVisible();
  await expect(chat.getByText("có áo này k", { exact: true })).toBeVisible();
  await expect(chat.getByRole("img", { name: "Ảnh sắp gửi" })).toHaveCount(0);

  answer();
  await expect(chat.getByRole("img", { name: "Ảnh đang gửi" })).toHaveCount(0);
  await expect(chat.getByRole("img", { name: "Ảnh sắp gửi" })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByText("Chưa gửi được tin nhắn. Vui lòng kiểm tra kết nối và thử lại.")).toBeVisible();
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
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
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByText("Còn hàng ạ.")).toBeVisible();
  releaseOldPoll();
  await expect(page.getByText("Còn hàng ạ.")).toBeVisible();
});

// Plan 2026-11-14, case 6: a send that fails gives the photo back, and no new
// photo is taken while the first one is being sent.
test("a failed photo send gives the photo back and ignores a second photo while sending", async ({ page }) => {
  const clientMessageIds: string[] = [];
  let fail: () => void = () => {};
  const failNow = new Promise<void>((resolve) => { fail = resolve; });
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ json: { messages: [] } });
      return;
    }
    // The photo goes up as multipart: read the message id out of the form.
    const form = route.request().postDataBuffer()?.toString("latin1") ?? "";
    clientMessageIds.push(form.match(/name="clientMessageId"\r\n\r\n([0-9a-f-]{36})/)?.[1] ?? "");
    if (clientMessageIds.length === 1) {
      await failNow;
      await route.abort("failed");
    } else {
      await route.fulfill({ json: { messages: [] } });
    }
  });

  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  const fileInput = chat.locator('input[type="file"]');
  const preview = chat.getByRole("img", { name: "Ảnh sắp gửi" });
  const sending = chat.getByRole("img", { name: "Ảnh đang gửi" });

  await fileInput.setInputFiles("public/images/shop-avatar.jpg");
  await expect(preview).toBeVisible();
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill("mẫu này còn không");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();

  // During the send: the photo and the text are in the "Đang gửi…" bubble, not the composer.
  await expect(chat.getByText("Đang gửi…")).toBeVisible();
  await expect(sending).toBeVisible();
  await expect(chat.getByText("mẫu này còn không", { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => clientMessageIds.length).toBe(1);
  const sendingSrc = await sending.getAttribute("src");
  expect(sendingSrc).toMatch(/^blob:/);

  // A second photo while sending is ignored: still one photo, no preview swap.
  await fileInput.setInputFiles({ name: "khac.png", mimeType: "image/png", buffer: pixelPng });
  await expect(preview).toHaveCount(0);
  await expect(sending).toHaveCount(1);
  await expect(sending).toHaveAttribute("src", sendingSrc!);

  // The request fails: the error shows and the photo is back in the composer.
  fail();
  await expect(chat.getByText("Chưa gửi được tin nhắn. Vui lòng kiểm tra kết nối và thử lại.")).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(sending).toHaveCount(0);
  await expect(chat.getByRole("textbox", { name: "Tin nhắn" })).toHaveValue("mẫu này còn không");
  // The preview is the same photo, its blob: URL not revoked: the image still loads.
  await expect(preview).toHaveAttribute("src", sendingSrc!);
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Gửi again resends the same message.
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect.poll(() => clientMessageIds.length).toBe(2);
  expect(clientMessageIds[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(clientMessageIds[1]).toBe(clientMessageIds[0]);
  await expect(preview).toHaveCount(0);
});

// Plan 2026-11-14, case 7 (shop chat): polling gives the log a new array every
// 3 s, but must not drag a reader who scrolled up back to the bottom.
const logOf = (chat: Locator) => chat.locator("div.overflow-y-auto");
const gapToBottom = (log: Locator) => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
// Moves the log to `fromBottom` px above its bottom edge (null = the very top)
// and waits for the scroll event, so the chat has noted the new position.
const scrollLog = (log: Locator, fromBottom: number | null) =>
  log.evaluate((el, offset) => new Promise<void>((resolve) => {
    const target = offset === null ? 0 : el.scrollHeight - el.clientHeight - offset;
    if (Math.abs(el.scrollTop - target) < 1) return resolve();
    el.addEventListener("scroll", () => resolve(), { once: true });
    el.scrollTop = target;
  }), fromBottom);

test("polling does not drag a reader who scrolled up to the bottom; own messages and bottom readers still follow", async ({ page }) => {
  const messages: Array<Record<string, unknown>> = Array.from({ length: 30 }, (_, i) => ({
    id: crypto.randomUUID(),
    sender: i % 2 === 0 ? "shopper" : "ai",
    text: `Tin nhắn số ${i + 1}: nội dung đủ dài để bong bóng chiếm vài dòng trên màn hình điện thoại.`,
    reply: null,
    createdAt: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
  }));
  let reads = 0;
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { text: string };
      messages.push({ id: crypto.randomUUID(), sender: "shopper", text: body.text, reply: null, createdAt: new Date().toISOString() });
      await route.fulfill({ json: { messages } });
      return;
    }
    reads += 1;
    await route.fulfill({ json: { messages } });
  });

  // 1. The chat opens at the bottom.
  await page.goto("/s/may-boutique");
  await page.getByRole("button", { name: "Chat với shop" }).first().focus();
  await page.keyboard.press("Enter");
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  const log = logOf(chat);
  await expect(log).toContainText("Tin nhắn số 30:");
  await expect.poll(() => gapToBottom(log), { timeout: 10_000 }).toBeLessThanOrEqual(2);
  expect(await log.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(500);

  // Scroll to the top and let two polls pass: the position and the page stay put.
  await scrollLog(log, null);
  const readsBefore = reads;
  await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThanOrEqual(readsBefore + 2);
  expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(5);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // 2. A staff message arrives while the reader is still scrolled up: the position is kept.
  const staffText = "Shop vừa kiểm tra tồn kho giúp bạn.";
  messages.push({ id: crypto.randomUUID(), sender: "staff", text: staffText, reply: null, createdAt: new Date().toISOString() });
  await expect(log.getByText(staffText)).toBeAttached({ timeout: 10_000 });
  const readsAfterStaff = reads;
  await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThanOrEqual(readsAfterStaff + 1);
  expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(5);
  expect(await gapToBottom(log)).toBeGreaterThan(500);

  // 3. Within 80 px of the bottom, a new message makes the log follow it.
  await scrollLog(log, 40);
  const nearText = "Còn size M nhé bạn.";
  messages.push({ id: crypto.randomUUID(), sender: "staff", text: nearText, reply: null, createdAt: new Date().toISOString() });
  await expect(log.getByText(nearText)).toBeAttached({ timeout: 10_000 });
  await expect.poll(() => gapToBottom(log), { timeout: 10_000 }).toBeLessThanOrEqual(2);
  await expect(log.getByText(nearText)).toBeInViewport();

  // 4. Scrolled up again, sending a message always returns to the bottom.
  await scrollLog(log, null);
  expect(await gapToBottom(log)).toBeGreaterThan(500);
  const own = "Mình lấy size M nhé";
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill(own);
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(log.getByText(own, { exact: true })).toBeAttached();
  await expect.poll(() => gapToBottom(log), { timeout: 10_000 }).toBeLessThanOrEqual(2);
});
