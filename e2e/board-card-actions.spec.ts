import { test, expect, type Locator, type Page } from "@playwright/test";

import { WORKSPACE_NAME, adminClient } from "./fixtures";

/**
 * What a board card can do besides being dragged.
 *
 * Until this pass a card was drag-only: no way to read a task, edit it, delete it, or add one to a
 * particular column without leaving for /tasks. These cover the paths that wiring opened, against
 * the real app rather than jsdom, because every one of them ends in a server action.
 *
 * Anything created here carries E2E_TASK_PREFIX and is removed in afterAll, so the shared seeded
 * workspace other specs read is left as global setup made it.
 */

const E2E_TASK_PREFIX = "E2E card action";
const SEEDED_TASK = "Today: take the bins out";

function column(page: Page, name: string): Locator {
  return page.getByRole("region", { name: new RegExp(`^${name}, `) });
}

function cardTitled(page: Page, title: string): Locator {
  return page.getByRole("heading", { name: title, exact: true });
}

async function workspaceId(): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.from("workspaces").select("id").eq("name", WORKSPACE_NAME);
  if (error) throw error;
  const id = data?.[0]?.id as string | undefined;
  if (!id) throw new Error(`no seeded workspace named ${WORKSPACE_NAME}`);
  return id;
}

test.afterAll(async () => {
  const admin = adminClient();
  await admin
    .from("tasks")
    .delete()
    .eq("workspace_id", await workspaceId())
    .like("title", `${E2E_TASK_PREFIX}%`);
});

test("pressing a card opens the task, and the edit lands on the board", async ({ page }) => {
  const renamed = `${E2E_TASK_PREFIX} renamed`;
  await page.goto("/board");

  await cardTitled(page, SEEDED_TASK).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const titleField = dialog.getByLabel("Title", { exact: true });
  await expect(titleField).toHaveValue(SEEDED_TASK);
  await titleField.fill(renamed);
  await dialog.getByRole("button", { name: /save/i }).click();

  await expect(dialog).toBeHidden();
  await expect(cardTitled(page, renamed)).toBeVisible();

  // Restore: the seeded task is read by other specs under its original title.
  await cardTitled(page, renamed).click();
  const reopened = page.getByRole("dialog");
  await reopened.getByLabel("Title", { exact: true }).fill(SEEDED_TASK);
  await reopened.getByRole("button", { name: /save/i }).click();
  await expect(cardTitled(page, SEEDED_TASK)).toBeVisible();
});

test("a task can be added straight into a column", async ({ page }) => {
  const title = `${E2E_TASK_PREFIX} in progress`;
  await page.goto("/board");

  await page.getByRole("button", { name: "Add a task to In Progress" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: /create|add task/i }).first().click();
  await expect(dialog).toBeHidden();

  // The point of the feature: it lands where it was asked for, not in the leftmost column.
  await expect(column(page, "In Progress").getByRole("heading", { name: title })).toBeVisible();

  const admin = adminClient();
  const { data } = await admin
    .from("tasks")
    .select("board_column_id, board_columns(name)")
    .eq("title", title);
  expect((data?.[0] as { board_columns?: { name: string } } | undefined)?.board_columns?.name).toBe(
    "In Progress"
  );
});

test("a card can be deleted from its menu, and asks first", async ({ page }) => {
  const title = `${E2E_TASK_PREFIX} to delete`;
  const admin = adminClient();

  await page.goto("/board");
  await page.getByRole("button", { name: "Add a task to Not Started" }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Title", { exact: true }).fill(title);
  await createDialog.getByRole("button", { name: /create|add task/i }).first().click();
  await expect(cardTitled(page, title)).toBeVisible();

  await page.getByRole("button", { name: `More actions for "${title}"` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  // The confirmation is the point: the task is still there until it is accepted.
  await expect(page.getByRole("button", { name: `Confirm delete "${title}"` })).toBeVisible();
  const { data: beforeConfirm } = await admin.from("tasks").select("id").eq("title", title);
  expect(beforeConfirm?.length).toBe(1);

  await page.getByRole("button", { name: `Confirm delete "${title}"` }).click();

  await expect(cardTitled(page, title)).toBeHidden();
  await expect
    .poll(async () => {
      const { data } = await admin.from("tasks").select("id").eq("title", title);
      return data?.length ?? 0;
    }, { message: "the task was not deleted" })
    .toBe(0);
});

test("an empty column says what it is for rather than sitting blank", async ({ page }) => {
  await page.goto("/board");

  await expect(
    column(page, "Blocked").getByText("Drop a task here, or add one below.")
  ).toBeVisible();
});
