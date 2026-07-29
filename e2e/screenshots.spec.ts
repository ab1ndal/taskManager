import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Every other assertion in this suite measures a property. A layout that drifts without violating
 * one still ships clean — and the five defects the first visual pass caught were all found by a
 * human looking at a picture. These are the pictures.
 *
 * Baselines are captured on chromium and the iPhone profile only. Firefox and WebKit rasterise text
 * differently enough that a third and fourth set of baselines would be maintenance without new
 * signal — the property-based specs already run in all four engines.
 *
 * Baselines are platform-specific (Playwright suffixes them with the OS), so a machine with
 * different font rendering regenerates rather than inherits: `npx playwright test screenshots
 * --update-snapshots`.
 */

const VISUAL_PROJECTS = ["chromium", "iphone"];

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !VISUAL_PROJECTS.includes(testInfo.project.name),
    "baselines are captured on chromium and iphone only"
  );
  // Transitions mid-capture are the classic flake; the app already collapses them under this.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/**
 * Relative update times ("just now", "3m ago") change between runs. So does the "Today: take the
 * bins out" fixture's due date: it is seeded as `new Date()` at seed time (see fixtures.ts), an
 * absolute calendar date rather than a relative one, so its <input type="date"> renders whatever day
 * the suite happens to run on — masked here rather than given a mask-free absolute date because it
 * is the one fixture task standing in for "due today" everywhere else that reads it (deadline
 * buckets, badges), and changing what it seeds would be a wider, non-obvious edit.
 */
function volatile(page: Page): Locator[] {
  return [page.locator("time"), page.locator('input[type="date"]')];
}

async function openTasks(page: Page) {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
}

async function openEdit(page: Page, title: string) {
  const direct = page.getByRole("button", { name: `Edit "${title}"` });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole("button", { name: `More actions for "${title}"` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
  }
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The thread loads after the dialog opens; capturing before it lands gives two different
  // pictures. Waited on by update text, not the author name — "Second Member" is also an assignee
  // checkbox label, which is present immediately and would satisfy the wait too early.
  await expect(dialog.getByText("Bins were collected early today.")).toBeVisible();
  return dialog;
}

for (const scheme of ["light", "dark"] as const) {
  test(`task list — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openTasks(page);

    await expect(page.locator("main")).toHaveScreenshot(
      `task-list-${scheme}.png`,
      { mask: volatile(page), maxDiffPixelRatio: 0.01 }
    );
  });

  test(`new-task dialog — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openTasks(page);
    await page.getByRole("button", { name: "New task" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot(
      `new-task-dialog-${scheme}.png`,
      { maxDiffPixelRatio: 0.01 }
    );
  });

  test(`edit-task dialog — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openTasks(page);
    const dialog = await openEdit(page, "Today: take the bins out");

    await expect(dialog).toHaveScreenshot(
      `edit-task-dialog-${scheme}.png`,
      { mask: volatile(page), maxDiffPixelRatio: 0.01 }
    );
  });

  // The dialog is taller than the viewport and scrolls internally, so the capture above stops at
  // the Updates panel. The Subtasks panel — three fields per row, and the only place a subtask's
  // details and due date are visible — needs its own picture.
  test(`edit-task dialog, scrolled to subtasks — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openTasks(page);
    const dialog = await openEdit(page, "Today: take the bins out");

    await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(dialog.getByPlaceholder("New subtask title")).toBeInViewport();

    await expect(dialog).toHaveScreenshot(`edit-task-subtasks-${scheme}.png`, {
      mask: volatile(page),
      maxDiffPixelRatio: 0.01,
    });
  });

  test(`workspace card — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/workspaces");
    await expect(page.locator("main")).toBeVisible();

    // The card root: name span → its column wrapper → the bordered card itself.
    const card = page.getByText("e2e-phase65 Household").first().locator("xpath=ancestor::div[2]");
    await expect(card).toBeVisible();
    await expect(card).toHaveScreenshot(
      `workspace-card-${scheme}.png`,
      { maxDiffPixelRatio: 0.01 }
    );
  });
}
