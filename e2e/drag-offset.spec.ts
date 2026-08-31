import { test, expect } from "@playwright/test";

/**
 * Regression: does the dragged board card follow the pointer?
 *
 * The board strip carried `contain: paint`, which made it a containing block for fixed-position
 * descendants. @hello-pangea/dnd lifts a card as `position: fixed` at its viewport coordinates, so
 * those coordinates were re-anchored to the strip and the card floated 98px below the cursor —
 * visible to anyone dragging, invisible to every keyboard-driven drag test in e2e/board.spec.ts.
 *
 * @hello-pangea/dnd positions the lifted card `position: fixed` at its viewport coordinates, so the
 * grab point must stay under the cursor for the whole drag. Any ancestor that establishes a
 * containing block for fixed descendants shifts it.
 */
test("a lifted board card stays under the cursor", async ({ page }) => {
  await page.goto("/board");
  const handle = page.locator("[data-rfd-drag-handle-draggable-id]").first();
  await expect(handle).toBeVisible();

  const before = (await handle.boundingBox())!;
  const grabX = before.x + before.width / 2;
  const grabY = before.y + before.height / 2;

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // Past the lift threshold, in steps, so the sensor sees real movement.
  for (const dy of [10, 40, 80, 120]) {
    await page.mouse.move(grabX, grabY + dy, { steps: 5 });
    await page.waitForTimeout(60);
  }

  const during = (await handle.boundingBox())!;
  const cursorY = grabY + 120;
  // Where the grab point sits now, relative to the cursor. 0 means the card tracks the pointer.
  const driftY = during.y + before.height / 2 - cursorY;
  const driftX = during.x + before.width / 2 - grabX;

  await page.mouse.up();
  console.log(`DRIFT x=${Math.round(driftX)} y=${Math.round(driftY)}`);
  // @hello-pangea/dnd starts the drag only after a 5px threshold and does not fold that first 5px
  // into the transform, so a few px of lag is the library's design, not a positioning fault.
  expect(Math.abs(driftY), `card is ${Math.round(driftY)}px off the cursor vertically`).toBeLessThan(8);
  expect(Math.abs(driftX), `card is ${Math.round(driftX)}px off the cursor horizontally`).toBeLessThan(8);
});
