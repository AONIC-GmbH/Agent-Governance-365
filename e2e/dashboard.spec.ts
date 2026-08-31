import { test, expect } from "@playwright/test";

test.describe("Dashboard smoke", () => {
  test("shows nav, dashboard, and projects from API", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Components" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Your Projects" })).toBeVisible({
      timeout: 30_000,
    });
    // Seeded memory-store projects owned by u1 (Max Mustermann).
    await expect(page.getByText("Sales Analytics Suite")).toBeVisible();
    await expect(page.getByText("Inventory Management")).toBeVisible();
  });
});
