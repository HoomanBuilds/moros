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

test("market creation exposes free price coverage and event backup sources", async ({ page }) => {
  await page.goto("/app/create");
  await expect(page.getByRole("button", { name: "FX", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Economics", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "FX", exact: true }).click();
  await expect(page.getByRole("button", { name: /^EUR\b/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^THB\b/ })).toBeVisible();

  await page.getByRole("button", { name: "Sports", exact: true }).click();
  await expect(page.getByText("Backup resolution sources", { exact: true })).toBeVisible();
  await expect(page.getByText(/official league, federation, tournament/i)).toBeVisible();
});
