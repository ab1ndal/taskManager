import { test, expect } from "@playwright/test";

/**
 * The proxy is the only thing standing between a signed-out visitor and the app shell, and between
 * a signed-in user and the login form. Neither direction had any automated coverage.
 */

test("a signed-in user cannot reach the login form", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/tasks$/);
});

test("a signed-in user is redirected to /tasks from the root", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(tasks)?$/);
  // Whatever `/` resolves to, it must not be the sign-in form.
  await expect(page.locator("form").getByRole("button", { name: "Sign in" })).toHaveCount(0);
});

test("password recovery links still reach the reset form while a session exists", async ({ page }) => {
  // A recovery link signs the user in before they set a new password, so the login redirect must
  // not swallow ?mode=reset — that would make password reset impossible.
  await page.goto("/login?mode=reset");
  await expect(page.getByText("Set new password")).toBeVisible();
});

test("a signed-out visitor is sent to the login form", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("form").getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.goto("/workspaces");
  await expect(page).toHaveURL(/\/login/);

  await context.close();
});
