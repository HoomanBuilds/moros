import { test, expect } from "@playwright/test";
import { NETWORK } from "../lib/network";

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
