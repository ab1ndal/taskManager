import { test, expect, type Page } from "@playwright/test";

/**
 * Both lists render optimistically, so the row appears before the write lands. Reloading on the
 * optimistic render cancels the in-flight server action and the assertion then fails for a reason
 * that has nothing to do with persistence — wait for the action's own response first.
 */
/**
 * Below `sm` a row's edit and delete actions live behind an overflow menu, so the direct button
 * only exists on the wider projects. Callers ask for "edit this task", not "click this button".
 */
async function openEdit(page: Page, taskTitle: string) {
  const direct = page.getByRole("button", { name: `Edit "${taskTitle}"` });
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await page.getByRole("button", { name: `More actions for "${taskTitle}"` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
  }
  await expect(page.getByRole("dialog")).toBeVisible();
}

function serverAction(page: Page, marker: string) {
  // Matched on the payload, not just "a POST to /tasks": the modal fires getTaskUpdates on open,
  // and waiting for the first POST resolves on that instead — before the write under test happens.
  return page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/tasks") &&
      res.status() < 400 &&
      (res.request().postData() ?? "").includes(marker)
  );
}

/**
 * The Phase 06 checks that were deferred for want of a real browser: an update and a subtask added
 * through the modal have to survive a reload, and a second member's update has to be attributed to
 * them rather than to "You".
 *
 * Dictation itself still needs a human — Chromium's fake-device flags do not drive the Web Speech
 * API, which is a cloud service in Chrome and absent in Firefox.
 */

test("an update posted in the edit modal persists across a reload", async ({ page }) => {
  await page.goto("/tasks");
  await openEdit(page, "Today: take the bins out");

  const dialog = page.getByRole("dialog");

  // The seeded thread is authored by the other member and must not be attributed to the reader.
  await expect(dialog.getByText("Second Member").first()).toBeVisible();

  const text = `E2E update ${Date.now()}`;
  await dialog.getByPlaceholder("Add an update…").fill(text);
  const posted = serverAction(page, text);
  await dialog.getByRole("button", { name: "Add update" }).click();
  await expect(dialog.getByText(text)).toBeVisible();
  await posted;

  await page.reload();
  await openEdit(page, "Today: take the bins out");
  await expect(page.getByRole("dialog").getByText(text)).toBeVisible();
});

test("a subtask added in the edit modal persists and appears on the task row", async ({ page }) => {
  await page.goto("/tasks");
  await openEdit(page, "Overdue: pay the water bill");

  const dialog = page.getByRole("dialog");
  const title = `E2E subtask ${Date.now()}`;
  await dialog.getByPlaceholder("New subtask title").fill(title);
  const saved = serverAction(page, title);
  await dialog.getByRole("button", { name: "Add subtask" }).click();
  await expect(dialog.getByText(title)).toBeVisible();
  await saved;

  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
});

test("the newest update is scrolled into view, not hidden below the fold of its list", async ({ page }) => {
  await page.goto("/tasks");
  await openEdit(page, "Today: take the bins out");
  const dialog = page.getByRole("dialog");

  // The seeded thread and the other projects' runs share this task, so the marker has to be unique
  // per project or the locator matches several rows at once.
  const tag = test.info().project.name;
  for (let i = 0; i < 4; i++) {
    const marker = `Filler ${tag} ${i}`;
    await dialog.getByPlaceholder("Add an update…").fill(marker);
    const posted = serverAction(page, marker);
    await dialog.getByRole("button", { name: "Add update" }).click();
    await expect(dialog.getByText(marker)).toBeVisible();
    await posted;
  }

  const last = dialog.getByText(`Filler ${tag} 3`);
  await expect(last).toBeInViewport();
});

test("filtering to Shared shows the filtered-empty state, not the first-run one", async ({ page }) => {
  await page.goto("/tasks?view=shared");
  await expect(page.getByText("Shared: plan the weekend shop")).toBeVisible();

  // Household is the only seeded workspace, and every task is in it, so filtering by the other kind
  // must produce the "nothing matches" variant rather than "no tasks yet".
  await page.goto("/tasks?workspace=work");
  await expect(page.getByText(/Nothing matches this view|No tasks yet/)).toBeVisible();
  await expect(page.getByText("Nothing matches this view")).toBeVisible();
});
