import { expect, test } from "@playwright/test";

test("starts the built app under the GitHub Pages base path", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("./");

  await expect(page.locator('script[type="module"][src]')).toHaveAttribute(
    "src",
    /^\/bob-gacha\/assets\//,
  );
  await expect(page).toHaveTitle("Bob Gacha");
  await expect(page.getByRole("heading", { name: "Bob Gacha" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
