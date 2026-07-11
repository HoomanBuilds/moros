import { test, expect } from "@playwright/test";

test("markets page renders the shell and a market card", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /markets/i }).first()).toBeVisible();
  await expect(page.getByText(/YES/i).first()).toBeVisible();
});

test("market terminal renders stats and chart section", async ({ page }) => {
  await page.goto("/app/market/main");
  await expect(page.getByText(/pool size/i).first()).toBeVisible();
  await expect(page.getByText(/live since open/i).first()).toBeVisible();
});
