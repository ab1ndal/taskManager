import { test, expect } from "@playwright/test";
import { cleanupUiWrites } from "./fixtures";

// Seeded names carry the E2E marker so the scoped teardown can find them: the dev project is
// shared with everyday local work (tasks/lessons.md L14).
//
// Each test seeding a row uses its own name rather than one shared `ITEM` const: the first test
// leaves its row archived and on the shopping list, and a second test reusing that name would then
// depend on what the first left behind in a database shared with everyday local work. Names still
// share the `E2E ` prefix so the teardown's `.like("name", "E2E %")` collects them all.

test.afterEach(async () => {
  await cleanupUiWrites();
});

test.describe("grocery list", () => {
  test("walks a full loop: add, need, bought, finish, re-add", async ({ page }) => {
    const ITEM = "E2E Bananas loop";
    await page.goto("/groceries?view=stock");

    // Add to the pantry. One field, Enter commits.
    await page.getByRole("textbox", { name: /add an item/i }).fill(ITEM);
    await page.getByRole("textbox", { name: /add an item/i }).press("Enter");
    await expect(page.getByText(ITEM)).toBeVisible();

    // Low stock: one tap puts it on the list while it stays in the pantry.
    const row = page.locator("li", { hasText: ITEM });
    await row.getByRole("button", { name: /need/i }).click();
    await expect(row.getByRole("button", { name: /need/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/groceries?view=buy");
    await expect(page.getByText(ITEM)).toBeVisible();

    // Bought returns it to the pantry and takes it off the list.
    await page.getByRole("button", { name: new RegExp(`bought ${ITEM}`, "i") }).click();
    await expect(page.getByText(ITEM)).toBeHidden();

    // Finished, keeping it on the list.
    await page.goto("/groceries?view=stock");
    await page.locator("li", { hasText: ITEM }).getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: /finished — add to list/i }).click();
    await expect(page.getByText(ITEM)).toBeHidden();

    await page.goto("/groceries?view=buy");
    await expect(page.getByText(ITEM)).toBeVisible();
  });

  test("re-adding an archived item resurrects one row rather than duplicating it", async ({
    page,
  }) => {
    const ITEM = "E2E Bananas readd";
    await page.goto("/groceries?view=stock");
    const input = page.getByRole("textbox", { name: /add an item/i });

    await input.fill(ITEM);
    await input.press("Enter");
    await page.locator("li", { hasText: ITEM }).getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: /finished — just remove/i }).click();
    await expect(page.getByText(ITEM)).toBeHidden();

    // Different case and trailing space: the unique index is on lower(btrim(name)).
    await input.fill(`${ITEM.toLowerCase()} `);
    await input.press("Enter");
    await expect(page.locator("li", { hasText: new RegExp(ITEM, "i") })).toHaveCount(1);
  });

  test("the sort control appears in the pantry only", async ({ page }) => {
    await page.goto("/groceries?view=stock");
    await expect(page.getByRole("group", { name: /sort/i })).toBeVisible();

    await page.goto("/groceries?view=buy");
    await expect(page.getByRole("group", { name: /sort/i })).toBeHidden();
  });

  test("/groceries redirects to a canonical view", async ({ page }) => {
    await page.goto("/groceries");
    await expect(page).toHaveURL(/\/groceries\?view=buy/);
  });
});
