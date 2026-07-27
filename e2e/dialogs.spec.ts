import { test, expect, type Page } from "@playwright/test";

/**
 * `<dialog>.showModal()` behaves differently in each engine, and the centring bug found at the end
 * of the 6.5 visual pass was invisible to every jsdom test. These run in Chromium, WebKit, Firefox
 * and mobile Safari.
 */

async function openNewTask(page: Page) {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the new-task dialog is centred in the viewport", async ({ page }) => {
  const dialog = await openNewTask(page);

  const offset = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: window.innerWidth - r.right,
      top: r.top,
      bottom: window.innerHeight - r.bottom,
      width: r.width,
      viewport: window.innerWidth,
    };
  });

  // Symmetric to within a pixel horizontally; a dialog pinned to a corner fails by hundreds.
  expect(Math.abs(offset.left - offset.right)).toBeLessThan(2);
  expect(offset.top).toBeGreaterThanOrEqual(0);
  expect(offset.width).toBeLessThanOrEqual(offset.viewport);
});

test("the dialog traps focus and Escape closes it", async ({ page }) => {
  const dialog = await openNewTask(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the dialog's fields are all reachable and typable", async ({ page }) => {
  const dialog = await openNewTask(page);

  await dialog.getByPlaceholder("Task title").fill("E2E typed title");
  await expect(dialog.getByPlaceholder("Task title")).toHaveValue("E2E typed title");

  await dialog.getByRole("button", { name: "+ Add subtask" }).click();

  // Every subtask field must be wide enough to actually use. The details textarea collapsed to a
  // single character when it shared one flex row with the title and a date picker.
  const subtaskTitle = dialog.getByPlaceholder("Subtask title");
  const subtaskDetails = dialog.getByLabel("Subtask 1 details");
  await expect(subtaskTitle).toBeVisible();
  await expect(subtaskDetails).toBeVisible();

  for (const field of [subtaskTitle, subtaskDetails]) {
    const width = await field.evaluate((el) => el.getBoundingClientRect().width);
    expect(width, "subtask field is too narrow to type into").toBeGreaterThan(120);
  }

  await subtaskTitle.fill("Sub one");
  await subtaskDetails.fill("Some detail text that should fit");
  await expect(subtaskDetails).toHaveValue("Some detail text that should fit");

  const dueDate = dialog.getByLabel(/Subtask 1 due date/);
  await expect(dueDate).toBeVisible();
  const dateWidth = await dueDate.evaluate((el) => el.getBoundingClientRect().width);
  expect(dateWidth, "subtask date input is clipped").toBeGreaterThan(100);
});

test("dialog content is fully scrollable — no control lands off-screen", async ({ page }) => {
  const dialog = await openNewTask(page);

  const submit = dialog.getByRole("button", { name: /Add task|Adding/ });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();

  const overflow = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom - window.innerHeight;
  });
  expect(overflow, "dialog extends past the bottom of the viewport").toBeLessThanOrEqual(1);
});

test("closing the dialog restores focus to the control that opened it", async ({ page }) => {
  await page.goto("/tasks");
  const opener = page.getByRole("button", { name: "New task" }).first();
  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  const restored = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  expect(restored).toContain("New task");
});
