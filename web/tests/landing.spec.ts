import { test, expect } from "@playwright/test";

test("landing renders brand, hero, and connect button", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Moros/);
  await expect(page.getByText(/Bet privately/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /built on stellar/i }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Stellar" }).first()).toBeVisible();
});

test("launch app link points to /app", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: /launch app/i }).first();
  await expect(link).toHaveAttribute("href", "/app");
});

test("whitepaper opens in the browser from the navbar and footer", async ({ page }) => {
  await page.goto("/");

  const navbarLink = page
    .locator("header nav")
    .getByRole("link", { name: /whitepaper/i });
  const footerLink = page
    .locator("footer")
    .getByRole("link", { name: /whitepaper/i });

  for (const link of [navbarLink, footerLink]) {
    await expect(link).toHaveAttribute("href", "/whitepaper.pdf");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).not.toHaveAttribute("download", "");
  }

  await expect(
    page.locator("header nav").getByRole("link", { name: "Protocol", exact: true }),
  ).toHaveCount(0);
});

test("whitepaper PDF is served inline", async ({ request }) => {
  const response = await request.get("/whitepaper.pdf");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"] ?? "").not.toContain("attachment");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("mobile navigation exposes the whitepaper", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Toggle menu", exact: true });
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#landing-mobile-menu")).toHaveClass(/opacity-100/);

  const link = page
    .getByRole("navigation", { name: "Mobile navigation", exact: true })
    .getByRole("link", { name: /whitepaper/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/whitepaper.pdf");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("landing states the current on-chain privacy properties", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText(/individual sides and quantities never appear on-chain in plaintext/i),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("2 of 3");
  await expect(page.locator("body")).not.toContainText("no-leak committee");
  await expect(page.locator("body")).not.toContainText("BLS12-381");
});
