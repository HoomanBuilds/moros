import { test, expect } from "@playwright/test";
import { NETWORK } from "../lib/network";
import { EVENT_CATEGORIES, EVENT_SOURCE_GUIDANCE } from "../lib/markets/categories";

test("markets page renders the shell and a market card", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /markets/i }).first()).toBeVisible();
  await expect(page.getByText(/YES/i).first()).toBeVisible();
});

test("market terminal renders stats and chart section", async ({ page }) => {
  await page.goto(`/app/market/${NETWORK.marketId}`);
  await expect(page.getByText(/pool collateral/i).first()).toBeVisible();
  await expect(page.getByText(/implied probability/i).first()).toBeVisible();
});

test("market creation groups free price feeds and event outcomes", async ({ page }) => {
  await page.goto("/app/create");
  await expect(page.getByRole("button", { name: "Price feeds", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Crypto price", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Sports", exact: true })).not.toBeVisible();

  await page.getByRole("button", { name: "FX", exact: true }).click();
  await expect(page.getByRole("button", { name: "EUR", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "THB", exact: true })).toBeVisible();
  await expect(page.getByText("Reflector fiat public feed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Event outcomes", exact: true }).click();
  await page.getByRole("button", { name: "Sports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Define the sports outcome", exact: true })).toBeVisible();
  await expect(page.getByLabel("Primary source URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Backup source URLs", { exact: true })).toBeVisible();
  await expect(page.getByText(/official league, federation, tournament/i)).toBeVisible();
  await expect(page.getByText("Void and refund rule", { exact: true })).toBeVisible();
});

test("every event category exposes its own creation guidance", async ({ page }) => {
  await page.goto("/app/create");
  await page.getByRole("button", { name: "Event outcomes", exact: true }).click();

  for (const category of EVENT_CATEGORIES) {
    await page.getByRole("button", { name: category, exact: true }).click();
    await expect(page.getByLabel("YES or NO question", { exact: true })).toHaveAttribute(
      "placeholder",
      EVENT_SOURCE_GUIDANCE[category].question,
    );
    await expect(page.getByLabel("Primary source URL", { exact: true })).toHaveAttribute(
      "placeholder",
      EVENT_SOURCE_GUIDANCE[category].source,
    );
  }
});

test("market creation stays usable on a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/create");
  await page.getByRole("button", { name: "Event outcomes", exact: true }).click();
  await page.getByRole("button", { name: "Politics", exact: true }).click();

  const categoryBox = await page.getByRole("button", { name: "Politics", exact: true }).boundingBox();
  expect(categoryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await page.getByRole("button", { name: "Politics", exact: true }).evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("none");
  await expect(page.getByRole("heading", { name: "Define the politics outcome", exact: true })).toBeVisible();
  await expect(page.getByText("Market preview", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
