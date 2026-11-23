import { test, expect } from "@playwright/test";

// The grocery page polls `router.refresh()` every 20 seconds. When that RSC fetch fails on a
// network error, Next falls back to a full-page navigation, so a phone with no signal used to land
// on the browser's offline error page and lose whatever was being typed. With refreshes skipped
// while offline, the page must stay put across more than one poll interval.
test("keeps the list and typed text through a poll while offline", async ({ page, context }) => {
  test.setTimeout(75_000);
  await page.goto("/groceries?view=buy");

  const input = page.getByRole("textbox", { name: /add an item/i });
  await expect(input).toBeVisible();
  // A full-page navigation would discard this window property along with the document.
  await page.evaluate(() => {
    (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
  });
  await input.fill("E2E half-typed oat milk");

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "No signal — showing your last list" })).toBeVisible();

  await page.waitForTimeout(25_000);

  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  await expect(input).toHaveValue("E2E half-typed oat milk");

  await context.setOffline(false);
  await expect(page.getByText("No signal — showing your last list")).toBeHidden();
});
