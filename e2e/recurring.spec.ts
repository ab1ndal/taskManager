import { test, expect, type Page } from "@playwright/test";
import { adminClient, E2E_TAG, cleanupUiWrites } from "./fixtures";

/**
 * Covers the recurring-task slice end to end: creating a repeating task, reactivating it through
 * `run_due_recurrences` rather than waiting on the 15-minute cron, and pausing a recurrence without
 * losing its schedule. Every task title carries `E2E_TAG` so `cleanupUiWrites` can find and remove
 * it — `task_rules` cascades off `tasks`, so removing the task removes its rule too.
 */

/**
 * Same convention as task-flow.spec.ts: the new-task form renders an optimistic row under a
 * client-generated id and only swaps in the real, persisted row once `createTaskWithSubtasks`
 * responds and `revalidatePath` lands. Completing or editing the task — or reading it back through
 * the admin client — has to wait for that response first, or it acts on an id the database has
 * never seen.
 */
function serverAction(page: Page, marker: string) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/tasks") &&
      res.status() < 400 &&
      (res.request().postData() ?? "").includes(marker)
  );
}

test.afterEach(async () => {
  await cleanupUiWrites();
});

test("a task can be created as recurring and shows the badge", async ({ page }) => {
  const title = `${E2E_TAG} Take trash`;

  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeats").check();
  await page.getByLabel("Repeat every").fill("3");
  await page.getByLabel("Repeat unit").selectOption("daily");

  const created = serverAction(page, title);
  await page.getByRole("button", { name: /add task/i }).click();
  await created;

  const card = page.getByText(title).locator("..");
  await expect(card.getByLabel("Repeats")).toBeVisible();
});

test("completing a recurring task and running the generator brings it back", async ({ page }) => {
  const admin = adminClient();
  const title = `${E2E_TAG} Water plants`;

  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeats").check();

  const created = serverAction(page, title);
  await page.getByRole("button", { name: /add task/i }).click();
  await created;

  // The row on screen right now is still the optimistic one, under a client-generated id the
  // database has never seen — `created` only confirms the write landed, not that the client has
  // swapped it for the real row. A reload forces the real, server-rendered id before anything below
  // acts on this task, instead of racing that client-side swap.
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();

  // Complete it — it leaves the active list and its "Mark ... complete" control goes with it.
  await page.getByRole("button", { name: `Mark "${title}" complete` }).click();
  await expect(page.getByRole("button", { name: `Mark "${title}" complete` })).toBeHidden();

  // Make the rule due, then run the generator deterministically rather than waiting on cron.
  const { data: task } = await admin.from("tasks").select("id").eq("title", title).single();
  const { error: updateError } = await admin
    .from("task_rules")
    .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("task_id", task!.id);
  expect(updateError).toBeNull();

  const { data: processed, error } = await admin.rpc("run_due_recurrences");
  expect(error).toBeNull();
  expect(processed).toBeGreaterThanOrEqual(1);

  // Same row, back on the active list — not a new task, and no longer completed.
  const { data: after } = await admin
    .from("tasks")
    .select("id, completed_at")
    .eq("id", task!.id)
    .single();
  expect(after!.id).toBe(task!.id);
  expect(after!.completed_at).toBeNull();

  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByRole("button", { name: `Mark "${title}" complete` })).toBeVisible();
});

test("a recurrence can be turned off from the edit modal", async ({ page }) => {
  const admin = adminClient();
  const title = `${E2E_TAG} Sweep porch`;

  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeats").check();

  const created = serverAction(page, title);
  await page.getByRole("button", { name: /add task/i }).click();
  await created;

  // See the note in the test above: force the real, server-rendered row before editing it.
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();

  await page.getByText(title).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Repeats")).toBeChecked();
  await dialog.getByLabel("Repeats").uncheck();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  const { data: task } = await admin.from("tasks").select("id").eq("title", title).single();
  const { data: rule } = await admin
    .from("task_rules")
    .select("is_active")
    .eq("task_id", task!.id)
    .single();

  // Paused, not deleted — turning Repeats back on restores the schedule.
  expect(rule!.is_active).toBe(false);
});
