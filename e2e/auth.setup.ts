import { test as setup, expect } from "@playwright/test";
import { TEST_USER } from "./fixtures";

const AUTH_FILE = "e2e/.auth/user.json";

/**
 * Signs in through the real login form rather than injecting a session, so the auth path itself is
 * covered and the cookies are exactly the ones @supabase/ssr writes in a browser.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_USER.password);
  // Two controls read "Sign in": the mode tab and the submit button. Scope to the form.
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/tasks", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
