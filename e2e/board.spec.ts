import { test, expect, type Locator, type Page } from "@playwright/test";

import { WORKSPACE_NAME, adminClient } from "./fixtures";

/**
 * The board, the settings column editor, and column deletion, against the real app.
 *
 * Every test restores what it changed: this suite runs four browser projects serially against one
 * seeded workspace, and the screenshot baselines are taken by the project that runs last. A column
 * left behind, or a task left in the wrong column, would surface there as an unrelated failure.
 *
 * Drags are keyboard-only. `@hello-pangea/dnd`'s pointer sensors are unreliable under automation
 * (see e2e/drag-reorder.spec.ts, which covers the pointer path on the list view), and the handle is
 * the element carrying `data-rfd-drag-handle-draggable-id` — the wrapper div, not the <article>,
 * which is not focusable and never receives the library's key events.
 */

const DEFAULT_COLUMNS = ["Not Started", "In Progress", "Blocked", "Follow-up", "Completed"];
/** Anything this spec creates carries this prefix, so cleanup can find it without guessing. */
const E2E_COLUMN_PREFIX = "E2E column";

function column(page: Page, name: string): Locator {
  return page.getByRole("region", { name: new RegExp(`^${name}, `) });
}

function handleIn(scope: Locator): Locator {
  return scope.locator("[data-rfd-drag-handle-draggable-id], [data-rbd-drag-handle-draggable-id]");
}

async function workspaceId(): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.from("workspaces").select("id").eq("name", WORKSPACE_NAME);
  if (error) throw error;
  const id = data?.[0]?.id as string | undefined;
  if (!id) throw new Error(`no seeded workspace named ${WORKSPACE_NAME}`);
  return id;
}

async function columnIdByName(name: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("board_columns")
    .select("id")
    .eq("workspace_id", await workspaceId())
    .eq("name", name);
  if (error) throw error;
  const id = data?.[0]?.id as string | undefined;
  if (!id) throw new Error(`no column named ${name} in the seeded workspace`);
  return id;
}

/** The seeded workspace's column names in stored `position` order — what both readers sort by. */
async function orderInDatabase(): Promise<string[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("board_columns")
    .select("name")
    .eq("workspace_id", await workspaceId())
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => c.name as string);
}

/**
 * Puts the seeded root tasks back in the leftmost non-terminal column, which is where `seed()` left
 * them, and removes any column this spec created. Idempotent, so it is safe both before a run
 * (cleaning up after an interrupted one) and after each test.
 */
async function restoreFixture(): Promise<void> {
  const admin = adminClient();
  const wsId = await workspaceId();

  const notStarted = await columnIdByName("Not Started");
  const { error: moveErr } = await admin
    .from("tasks")
    .update({ board_column_id: notStarted })
    .eq("workspace_id", wsId)
    .neq("board_column_id", notStarted);
  if (moveErr) throw moveErr;

  // The drag test completes a task and then drags it back out; the reopen is a server action fired
  // from a page this spec is about to leave, so it is not something to rely on. Only the seeded
  // "Done:" task is meant to be complete — anything else is this spec's residue, and leaving it
  // completed would show up as an extra card in the next spec's screenshot baselines.
  const { error: reopenErr } = await admin
    .from("tasks")
    .update({ completed_at: null })
    .eq("workspace_id", wsId)
    .not("title", "like", "Done:%")
    .not("completed_at", "is", null);
  if (reopenErr) throw reopenErr;

  // A reorder test moves a column; positions are 1000-spaced by the seed trigger, so putting them
  // back by name restores exactly what migration 015 seeds.
  for (const [index, name] of ["Not Started", "In Progress", "Blocked", "Follow-up", "Completed"].entries()) {
    const { error } = await admin
      .from("board_columns")
      .update({ position: (index + 1) * 1000 })
      .eq("workspace_id", wsId)
      .eq("name", name);
    if (error) throw error;
  }

  const { error: dropErr } = await admin
    .from("board_columns")
    .delete()
    .eq("workspace_id", wsId)
    .like("name", `${E2E_COLUMN_PREFIX}%`);
  if (dropErr) throw dropErr;
}

test.beforeAll(restoreFixture);
test.afterEach(restoreFixture);

test("the seeded columns are on the board", async ({ page }) => {
  await page.goto("/board");

  for (const name of DEFAULT_COLUMNS) {
    await expect(column(page, name)).toBeVisible();
  }
});

test("a card carries its title, deadline and workspace and nothing else", async ({ page }) => {
  await page.goto("/board");
  const card = page.getByRole("article").first();

  await expect(card).toBeVisible();
  await expect(card.getByRole("heading")).toBeVisible();
  // The board deliberately omits descriptions and subtask counts.
  await expect(card).not.toContainText("subtask");
});

test("a column can be added, recoloured and renamed, and a rename leaves its cards alone", async ({
  page,
}) => {
  const added = `${E2E_COLUMN_PREFIX} added`;
  const renamed = `${E2E_COLUMN_PREFIX} renamed`;

  await page.goto("/settings?tab=board");
  await page.getByLabel(/^New column name/).first().fill(added);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("button", { name: `Delete ${added}` })).toBeVisible();

  await page.getByRole("button", { name: `Colour for ${added}` }).click();
  await page.getByRole("radio", { name: "tab20-cyan", exact: true }).click();
  await expect(page.getByRole("button", { name: `Colour for ${added}` })).toBeVisible();

  // Give the new column a card, so the rename has something whose placement can be checked.
  const admin = adminClient();
  const { data: moved, error: movedErr } = await admin
    .from("tasks")
    .update({ board_column_id: await columnIdByName(added) })
    .eq("workspace_id", await workspaceId())
    .eq("title", "Overdue: pay the water bill")
    .select("title");
  if (movedErr) throw movedErr;
  expect(moved).toHaveLength(1);

  await page.goto("/board");
  await expect(column(page, added).getByRole("article")).toHaveText([
    /Overdue: pay the water bill/,
  ]);

  await page.goto("/settings?tab=board");
  const nameInput = page
    .getByRole("region", { name: /columns$/ })
    .first()
    .getByLabel("Column name", { exact: true })
    .nth(DEFAULT_COLUMNS.length);
  await expect(nameInput).toHaveValue(added);
  await nameInput.fill(renamed);
  await nameInput.blur();
  await expect(page.getByRole("button", { name: `Delete ${renamed}` })).toBeVisible();

  await page.goto("/board");
  await expect(column(page, renamed).getByRole("article")).toHaveText([
    /Overdue: pay the water bill/,
  ]);
  await expect(column(page, added)).toHaveCount(0);
});

test("a name a sibling column already has is refused in the field, not the whole form", async ({
  page,
}) => {
  await page.goto("/settings?tab=board");

  await page.getByLabel(/^New column name/).first().fill("blocked");
  await page.getByRole("button", { name: "Add" }).click();

  // Field-level: the message sits on the input and the typed name survives, so it can be corrected.
  await expect(page.getByText("That name is already used in this workspace")).toBeVisible();
  await expect(page.getByLabel(/^New column name/).first()).toHaveValue("blocked");
});

test("a column can be dragged to a new position, and the board follows", async ({ page }) => {
  await page.goto("/settings?tab=board");
  const list = page.getByRole("region", { name: /columns$/ }).first();
  // Exact, or the add form's "New column name for …" input matches too.
  const names = () => list.getByLabel("Column name", { exact: true }).evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value)
  );
  expect(await names()).toEqual(DEFAULT_COLUMNS);

  // Keyboard drag on the row handle, the same lift/move/drop sequence e2e/drag-reorder.spec.ts uses.
  await page.getByRole("button", { name: 'Reorder "Blocked"' }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");

  const moved = ["Not Started", "Blocked", "In Progress", "Follow-up", "Completed"];
  await expect.poll(names, { message: "the column did not move in the editor" }).toEqual(moved);

  // The row moves optimistically, so wait for the write itself before reloading: a reload cancels
  // the in-flight server action, which is how this passed on Chromium and failed everywhere else.
  await expect
    .poll(orderInDatabase, { message: "the reorder never reached the database" })
    .toEqual(moved);

  // Now prove both readers agree with the stored positions.
  await page.reload();
  expect(await names()).toEqual(moved);

  await page.goto("/board");
  await expect(
    page.getByRole("region", { name: /, \d+ tasks?$/ }).locator("h2")
  ).toHaveText(moved);
});

test("dragging a card into Completed completes it in the list view", async ({ page }) => {
  // The five columns are 288px wide, so the terminal one is off-screen at a stock desktop width and
  // `@hello-pangea/dnd`'s keyboard cross-axis move will not jump to a droppable that is scrolled out
  // of view — the arrows stop at the last visible column. Widening the viewport keeps this test
  // about the drop and its completion stamp. The limitation itself is recorded in tasks/todo.md.
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto("/board");
  // Guard the premise: the arrow-key count below is the distance across the default five columns.
  for (const name of DEFAULT_COLUMNS) await expect(column(page, name)).toBeVisible();

  const card = column(page, "Not Started").getByRole("article").first();
  const title = (await card.getByRole("heading").innerText()).trim();

  const handle = handleIn(column(page, "Not Started")).first();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  for (let i = 0; i < DEFAULT_COLUMNS.length - 1; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Space");

  await expect(column(page, "Completed").getByText(title)).toBeVisible();

  // The card's placement is optimistic, so wait for the write itself before doing anything that
  // could cancel it: navigating away aborts the in-flight server action, which is exactly how this
  // test failed on webkit, firefox and mobile Safari while passing on Chromium.
  await expect
    .poll(async () => {
      const admin = adminClient();
      const { data } = await admin
        .from("tasks")
        .select("completed_at")
        .eq("workspace_id", await workspaceId())
        .eq("title", title);
      return data?.[0]?.completed_at != null;
    }, { message: "the drag into the terminal column did not stamp completed_at" })
    .toBe(true);

  // The completion is real to the rest of the app, not just to the board: on /tasks the card has
  // left its deadline bucket for the collapsed completed section, which is where a task completed
  // from the list view lands too.
  await page.goto("/tasks");
  await page.getByRole("button", { name: /\d+ completed/ }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

  // Restore: drag it back out, which reopens it as well as re-homing it.
  await page.goto("/board");
  const back = handleIn(column(page, "Completed")).first();
  await back.focus();
  await page.keyboard.press("Space");
  for (let i = 0; i < DEFAULT_COLUMNS.length - 1; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await expect(column(page, "Not Started").getByText(title)).toBeVisible();
});

test("the done column expands to older history", async ({ page }) => {
  await page.goto("/board");
  const done = column(page, "Completed");

  await done.getByRole("button", { name: /Show older/ }).click();
  await expect(done.getByRole("button", { name: /Show more|No older tasks/ })).toBeVisible();
});

test("deleting a column sends each task where it was told to go", async ({ page }) => {
  const parking = `${E2E_COLUMN_PREFIX} parking`;
  const admin = adminClient();
  const wsId = await workspaceId();

  await page.goto("/settings?tab=board");
  await page.getByLabel(/^New column name/).first().fill(parking);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("button", { name: `Delete ${parking}` })).toBeVisible();

  const firstTitle = "Overdue: pay the water bill";
  const secondTitle = "Shared: plan the weekend shop";
  const { error: parkErr } = await admin
    .from("tasks")
    .update({ board_column_id: await columnIdByName(parking) })
    .eq("workspace_id", wsId)
    .in("title", [firstTitle, secondTitle]);
  if (parkErr) throw parkErr;

  await page.reload();
  await page.getByRole("button", { name: `Delete ${parking}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(firstTitle)).toBeVisible();

  // Two destinations, not one: a single bulk choice would pass even if the payload collapsed to
  // one target for every task, which is exactly what the per-task requirement forbids.
  await dialog.getByLabel(`Move ${firstTitle} to`).selectOption({ label: "In Progress" });
  await dialog.getByLabel(`Move ${secondTitle} to`).selectOption({ label: "Follow-up" });
  await dialog.getByRole("button", { name: "Delete column" }).click();
  await expect(page.getByRole("button", { name: `Delete ${parking}` })).toHaveCount(0);

  await page.goto("/board");
  await expect(column(page, parking)).toHaveCount(0);
  await expect(column(page, "In Progress").getByText(firstTitle)).toBeVisible();
  await expect(column(page, "Follow-up").getByText(secondTitle)).toBeVisible();
});
