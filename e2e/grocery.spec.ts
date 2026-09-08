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

    // Scoped to an <li> that carries a row's own Actions menu, so a plain `hasText` match can
    // never be satisfied by the add row's suggestion chip — that chip is a <li> too, and it
    // repeats the item's name with no menu of its own. Without this, the final assertion below
    // was satisfied by the chip alone (rendered client-side from the input's uncommitted text)
    // before the re-add's own POST had landed, so the test returned early and the still-in-flight
    // write got cancelled by the next test's context teardown — inserting the lowercased name
    // after this test's own cleanup had already run.
    const row = (name: string) =>
      page
        .locator("li")
        .filter({ has: page.getByRole("button", { name: /actions/i }) })
        .filter({ hasText: new RegExp(name, "i") });

    await input.fill(ITEM);
    await input.press("Enter");
    await expect(row(ITEM)).toBeVisible();

    await row(ITEM).getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: /finished — just remove/i }).click();
    await expect(row(ITEM)).toBeHidden();

    // Different case and trailing space: the unique index is on lower(btrim(name)).
    await input.fill(`${ITEM.toLowerCase()} `);
    await input.press("Enter");
    await expect(row(ITEM)).toHaveCount(1);
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

test("edits pantry details and retains workspace between views", async ({ page }) => {
  const name = "E2E Milk edit";
  await page.goto("/groceries?view=stock");
  await page.getByRole("textbox", { name: "Add an item" }).fill(name);
  await page.getByRole("textbox", { name: "Add an item" }).press("Enter");
  const row = page.locator("li").filter({ has: page.getByRole("button", { name: `Actions for ${name}` }) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /actions/i }).click();
  await page.getByRole("menuitem", { name: "Edit item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Category").selectOption("dairy");
  await dialog.getByLabel("Quantity").fill("3");
  await dialog.getByLabel("Expiry date").fill("2020-01-01");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("3", { exact: true })).toBeVisible();
  await expect(row.getByText("expired", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Still good" }).click();
  await expect(row.getByText("expired", { exact: true })).toBeHidden();
  await row.getByRole("button", { name: "Need", exact: true }).click();
  await expect(row.getByRole("button", { name: "Need", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Shopping list", exact: true }).click();
  await expect(page).toHaveURL(/view=buy&workspace=/);
  const workspace = new URL(page.url()).searchParams.get("workspace");
  expect(workspace).toBeTruthy();
  await expect(page.getByText("have 3", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Pantry", exact: true }).click();
  await expect(page).toHaveURL(/view=stock&workspace=/);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(workspace);
});
