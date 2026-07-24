import { test, expect } from "@playwright/test";

test("markets page renders its discovery controls", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /markets/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "All topics", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sports", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search markets...", exact: true })).toBeVisible();
});

test("portfolio provides one reusable private USDC wallet", async ({ page }) => {
  await page.goto("/app/portfolio");
  await expect(page.getByRole("heading", { name: "Private USDC balance", exact: true })).toBeVisible();
  await expect(page.getByText(/use the same private balance across every Moros bet/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet to unlock", exact: true })).toBeVisible();
});

test("liquidity uses one automatic private pool", async ({ page }) => {
  await page.goto("/app/liquidity");
  await expect(
    page.getByRole("heading", { name: "Moros liquidity pool", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/deposit private USDC once.*automatically supplies approved markets/i),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("button", {
      name: "Connect wallet",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Fund markets", { exact: true })).not.toBeVisible();
});

test("market terminal fails closed for an unknown market", async ({ page }) => {
  await page.goto(`/app/market/C${"A".repeat(55)}`);
  await expect(page.getByRole("heading", { name: "Market not found", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse markets", exact: true })).toHaveAttribute("href", "/app");
});

test("market creation exposes supported feeds and blocks unsupported events", async ({ page }) => {
  await page.goto("/app/create");
  await expect(page.getByRole("button", { name: "Price feeds", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Crypto price", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "FX", exact: true }).click();
  await expect(page.getByRole("button", { name: "EUR", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "THB", exact: true })).toBeVisible();
  await expect(page.getByText("Reflector fiat public feed", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Event outcomes - Soon", exact: true })).toBeDisabled();
  await expect(page.getByText(/sports, politics, weather, economics, and other event markets stay unavailable/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sports", exact: true })).not.toBeVisible();
});

test("market creation accepts an exact local settlement time", async ({ page }) => {
  await page.goto("/app/create");
  const settlement = page.getByLabel("Exact settlement time", { exact: true });
  await expect(settlement).toHaveAttribute("type", "datetime-local");
  await expect(settlement).not.toHaveAttribute("max");
  await expect(settlement).not.toHaveValue("");
  await expect(page.getByRole("button", { name: "1 hour", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "30 days", exact: true })).toHaveAttribute("aria-pressed", "true");

  const customValue = "2045-07-20T08:45";
  await settlement.fill(customValue);
  await expect(settlement).toHaveValue(customValue);
  await expect(page.getByText(/^UTC:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "30 days", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("market creation stays usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/create");
  await page.getByRole("button", { name: "Gold price", exact: true }).click();

  const categoryBox = await page.getByRole("button", { name: "Gold price", exact: true }).boundingBox();
  expect(categoryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await page.getByRole("button", { name: "Gold price", exact: true }).evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("none");
  await expect(page.getByText("Market preview", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Exact settlement time", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
