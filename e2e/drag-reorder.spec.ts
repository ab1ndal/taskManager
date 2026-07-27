import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Drag-to-reorder is the one interaction that is pure pointer and touch behaviour, and it had no
 * end-to-end coverage in any browser. The unit tests call `buildDragEndHandler` directly with a
 * fabricated `DropResult`, which verifies the key arithmetic and nothing about whether a drag can
 * be started at all — `@hello-pangea/dnd` is driven by real sensors, and its lock check rejects a
 * drag from a native button unless `disableInteractiveElementBlocking` is set.
 *
 * The seeded Upcoming bucket holds two tasks, which is the smallest list a reorder can be observed
 * in. Every test restores the original order before it ends, so the fixtures other specs read stay
 * as global setup left them.
 */

const BUCKET = "Upcoming";
const FIRST = "Renew the household contents insurance policy before the end of the month";
const SECOND = "Shared: plan the weekend shop";

function bucket(page: Page): Locator {
  return page.locator(`[data-rfd-droppable-id="${BUCKET}"], [data-rbd-droppable-id="${BUCKET}"]`);
}

async function titlesInBucket(page: Page): Promise<string[]> {
  const handles = bucket(page).getByRole("button", { name: /^Reorder "/ });
  const labels = await handles.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  );
  return labels.map((l) => l.replace(/^Reorder "/, "").replace(/"$/, ""));
}

function handleFor(page: Page, title: string): Locator {
  return page.getByRole("button", { name: `Reorder "${title}"` });
}

/** The reorder write is a server action POST carrying the moved task's id. */
function reorderWrite(page: Page) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === "POST" && res.url().includes("/tasks") && res.status() < 400
  );
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Keyboard drag: focus the handle, Space to lift, an arrow to move, Space to drop. */
async function keyboardMove(page: Page, title: string, key: "ArrowDown" | "ArrowUp") {
  await handleFor(page, title).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press(key);
  const written = reorderWrite(page);
  await page.keyboard.press("Space");
  await written;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tasks");
  await expect(bucket(page)).toBeVisible();
  // Guard the premise: every assertion below is about a two-row bucket in a known order.
  expect(await titlesInBucket(page)).toEqual([FIRST, SECOND]);
});

test("a pointer drag reorders a bucket and the new order survives a reload", async ({
  page,
  isMobile,
}) => {
  const handle = handleFor(page, FIRST);
  const from = await centerOf(handle);
  const to = await centerOf(handleFor(page, SECOND));

  if (isMobile) {
    // Touch: `@hello-pangea/dnd` only claims a touch drag after its long-press threshold (120ms),
    // and Playwright's touchscreen API exposes taps only — so the sequence is dispatched directly.
    await handle.dispatchEvent("touchstart", {
      touches: [{ clientX: from.x, clientY: from.y }],
      changedTouches: [{ clientX: from.x, clientY: from.y }],
      targetTouches: [{ clientX: from.x, clientY: from.y }],
    });
    await page.waitForTimeout(200);
    for (const step of [0.34, 0.67, 1]) {
      const y = from.y + (to.y - from.y + 10) * step;
      await handle.dispatchEvent("touchmove", {
        touches: [{ clientX: from.x, clientY: y }],
        changedTouches: [{ clientX: from.x, clientY: y }],
        targetTouches: [{ clientX: from.x, clientY: y }],
      });
      await page.waitForTimeout(60);
    }
    const written = reorderWrite(page);
    await handle.dispatchEvent("touchend", {
      touches: [],
      changedTouches: [{ clientX: from.x, clientY: to.y + 10 }],
      targetTouches: [],
    });
    await written;
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Several small moves, not one jump: the library needs movement past its drag threshold and
    // then position updates to compute a drop index.
    for (const step of [0.25, 0.5, 0.75, 1]) {
      await page.mouse.move(from.x, from.y + (to.y - from.y + 10) * step, { steps: 5 });
      await page.waitForTimeout(40);
    }
    const written = reorderWrite(page);
    await page.mouse.up();
    await written;
  }

  await expect
    .poll(() => titlesInBucket(page), { message: "bucket did not reorder after the drag" })
    .toEqual([SECOND, FIRST]);

  await page.reload();
  expect(await titlesInBucket(page)).toEqual([SECOND, FIRST]);

  // Put the fixtures back the way global setup left them.
  await keyboardMove(page, FIRST, "ArrowUp");
  await expect.poll(() => titlesInBucket(page)).toEqual([FIRST, SECOND]);
});

test("the keyboard path reorders a bucket and the new order survives a reload", async ({ page }) => {
  await keyboardMove(page, FIRST, "ArrowDown");

  await expect
    .poll(() => titlesInBucket(page), { message: "bucket did not reorder from the keyboard" })
    .toEqual([SECOND, FIRST]);

  await page.reload();
  expect(await titlesInBucket(page)).toEqual([SECOND, FIRST]);

  await keyboardMove(page, FIRST, "ArrowUp");
  await expect.poll(() => titlesInBucket(page)).toEqual([FIRST, SECOND]);
});
