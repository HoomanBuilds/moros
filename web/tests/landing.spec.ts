import { test, expect } from "@playwright/test";

test("landing renders brand, hero, and connect button", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Moros/);
  await expect(page.getByText(/Bet privately/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
});

test("launch app link points to /app", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: /launch app/i }).first();
  await expect(link).toHaveAttribute("href", "/app");
});

test("landing discloses the current coordinator privacy limit", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText(/current coordinator runs on one VM and is not threshold privacy/i),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("2 of 3");
  await expect(page.locator("body")).not.toContainText("no-leak committee");
  await expect(page.locator("body")).not.toContainText("BLS12-381");
});
