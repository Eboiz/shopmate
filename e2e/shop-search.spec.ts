import { expect, test, type Page, type Route } from "@playwright/test";

// PB-34: the grid's search bar by description or photo, against a mocked API.
const VAY = "11111111-1111-4111-8111-111111111111";
const QUAN = "22222222-2222-4222-8222-222222222222";
const AO = "33333333-3333-4333-8333-333333333333";
const product = (id: string, name: string) => ({ id, name, price: 350000, imageUrl: null, colors: ["Be"], sizesInStock: ["S", "M"] });
const catalog = {
  shop: { name: "Mây Boutique" },
  products: [product(VAY, "Váy hoa"), product(QUAN, "Quần jean"), product(AO, "Áo thun")],
};
const SMALL_PHOTO = "public/images/shop-avatar.jpg";
const BIG_PHOTO = "public/images/hero-boutique.jpg";

const grid = (page: Page) => page.locator("#san-pham");
const searchBox = (page: Page) => grid(page).getByRole("searchbox", { name: "Tìm sản phẩm" });
const count = (page: Page) => grid(page).getByText(/\d+ \/ 3 sản phẩm/);
const resultsHeading = (page: Page) => grid(page).getByRole("heading", { name: /Kết quả/ });

// Every search request, answered by `answer` (which may delay).
async function mockApi(page: Page, answer: (route: Route, index: number) => Promise<void>) {
  const searches: string[] = [];
  await page.route("**/api/shops/may-boutique/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/shops/may-boutique/chat", (route) => route.fulfill({ json: { messages: [] } }));
  await page.route("**/api/shops/may-boutique/search", async (route) => {
    searches.push(route.request().postData() ?? "");
    await answer(route, searches.length - 1);
  });
  return searches;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("typing while a search is pending drops its late answer", async ({ page }) => {
  await mockApi(page, async (route) => {
    await delay(1200);
    await route.fulfill({ json: { mode: "semantic", productIds: [VAY] } });
  });
  await page.goto("/s/may-boutique#san-pham");
  await searchBox(page).fill("váy");
  await searchBox(page).press("Enter");
  await searchBox(page).fill("quần");
  await delay(1800);
  await expect(resultsHeading(page)).toHaveCount(0);
  // The instant filter for "quần" stays.
  await expect(count(page)).toHaveText("1 / 3 sản phẩm");
  await expect(grid(page).getByText("Quần jean")).toBeVisible();
});

test("the header search and Back leave the description results", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, (route) => route.fulfill({ json: { mode: "semantic", productIds: [VAY, AO] } }));
  await page.goto("/s/may-boutique#san-pham");

  await searchBox(page).fill("đồ đi biển");
  await searchBox(page).press("Enter");
  await expect(resultsHeading(page)).toHaveText("Kết quả cho “đồ đi biển”");
  const header = page.getByRole("searchbox", { name: "Tìm sản phẩm trong shop" });
  await header.fill("quần");
  await header.press("Enter");
  await expect(resultsHeading(page)).toHaveCount(0);
  await expect(count(page)).toHaveText("1 / 3 sản phẩm");

  await searchBox(page).fill("đồ đi biển");
  await searchBox(page).press("Enter");
  await expect(resultsHeading(page)).toBeVisible();
  await page.goBack();
  await expect(resultsHeading(page)).toHaveCount(0);
});

test.describe("photo preparation", () => {
  // createImageBitmap is slow for the big photo, so its preparation ends last.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = (async (image: ImageBitmapSource, ...rest: unknown[]) => {
        if (image instanceof Blob && image.size > 100_000) await new Promise((resolve) => setTimeout(resolve, 1500));
        return (original as (...args: unknown[]) => Promise<ImageBitmap>)(image, ...rest);
      }) as typeof window.createImageBitmap;
    });
  });

  test("a slower first photo cannot replace a later one", async ({ page }) => {
    const searches = await mockApi(page, (route) => route.fulfill({ json: { mode: "semantic", productIds: [QUAN] } }));
    await page.goto("/s/may-boutique#san-pham");
    const file = grid(page).locator('input[type="file"]');
    await file.setInputFiles(BIG_PHOTO);
    await file.setInputFiles(SMALL_PHOTO);
    await expect(resultsHeading(page)).toHaveText("Kết quả tìm bằng ảnh");
    await delay(2200);
    expect(searches).toHaveLength(1);
    await expect(grid(page).getByAltText("Ảnh đang tìm")).toHaveCount(1);
  });

  test("clearing while a photo is being prepared drops it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const searches = await mockApi(page, (route) => route.fulfill({ json: { mode: "semantic", productIds: [QUAN] } }));
    await page.goto("/s/may-boutique#san-pham");
    await searchBox(page).fill("áo");
    await grid(page).locator('input[type="file"]').setInputFiles(BIG_PHOTO);
    await page.getByRole("searchbox", { name: "Tìm sản phẩm trong shop" }).first().fill("váy");
    await page.getByRole("searchbox", { name: "Tìm sản phẩm trong shop" }).first().press("Enter");
    await delay(2200);
    expect(searches).toHaveLength(0);
    await expect(grid(page).getByAltText("Ảnh đang tìm")).toHaveCount(0);
  });
});

test("with the search service off, Hỏi trợ lý AI opens the chat with the typed text as a draft", async ({ page }) => {
  const chatPosts: unknown[] = [];
  await mockApi(page, (route) => route.fulfill({ json: { mode: "unavailable" } }));
  await page.route("**/api/shops/may-boutique/chat", (route) => {
    if (route.request().method() === "POST") chatPosts.push(route.request().postDataJSON());
    return route.fulfill({ json: { messages: [] } });
  });
  await page.goto("/s/may-boutique#san-pham");
  await searchBox(page).fill("túi xách da");
  await searchBox(page).press("Enter");
  await expect(grid(page).getByText("Không tìm thấy sản phẩm")).toBeVisible();
  await grid(page).getByRole("button", { name: "Hỏi trợ lý AI" }).click();
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  await expect(chat.getByRole("textbox", { name: "Tin nhắn" })).toHaveValue("túi xách da");
  await delay(500);
  expect(chatPosts).toHaveLength(0);
});

test("a long one-word query keeps the page within 375 px", async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ json: { mode: "semantic", productIds: [VAY] } }));
  await page.goto("/s/may-boutique#san-pham");
  await searchBox(page).fill("a".repeat(200));
  await searchBox(page).press("Enter");
  await expect(resultsHeading(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("the photo thumbnail survives leaving the page and coming back", async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ json: { mode: "semantic", productIds: [VAY] } }));
  await page.goto("/s/may-boutique#san-pham");
  await grid(page).locator('input[type="file"]').setInputFiles(SMALL_PHOTO);
  await expect(resultsHeading(page)).toHaveText("Kết quả tìm bằng ảnh");
  await grid(page).getByRole("link", { name: "Váy hoa", exact: true }).click();
  await expect(page).toHaveURL(`/s/may-boutique/p/${VAY}`);
  await page.goBack();
  const thumb = grid(page).getByAltText("Ảnh đang tìm");
  await expect(thumb).toBeVisible();
  // The thumbnail's object URL still loads (not revoked while the page was hidden).
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});
