import { test, expect, type Page } from "@playwright/test";

/**
 * Layout facts that only exist once a real engine has done layout: overflow, landmark count,
 * element overlap, and whether a control is actually reachable at the viewport it ships on.
 */

// `/profile` redirects to `/settings`, so naming it here exercised the settings page by accident.
// Both settings tabs are named explicitly, and `/board` — the widest page in the app, and the one
// that scrolls horizontally by design inside its own container — is on the list in its own right.
const PAGES = [
  "/tasks",
  "/workspaces",
  "/board",
  "/groceries?view=buy",
  "/groceries?view=stock",
  "/settings?tab=profile",
  "/settings?tab=board",
];

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth > 1;
  });
}

for (const path of PAGES) {
  test(`${path} does not scroll horizontally`, async ({ page }) => {
    await page.goto(path);
    if (path.startsWith("/groceries")) await expect(page.getByRole("textbox", { name: "Add an item" })).toBeVisible();
    // Streaming can briefly keep a hidden page beside the loading fallback in the DOM.
    // Count the exposed landmark rather than that hidden transport markup.
    await expect(page.getByRole("main")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test(`${path} has exactly one main landmark`, async ({ page }) => {
    await page.goto(path);
    if (path.startsWith("/groceries")) await expect(page.getByRole("textbox", { name: "Add an item" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });
}

/**
 * Scans what is on screen right now. Taking a root lets the same rule run inside an open dialog:
 * the original scan only ever saw /tasks with every modal closed, which is why fourteen undersized
 * controls lived in the modals and on the login and workspace screens without failing anything.
 */
async function undersizedControls(page: Page) {
  return page.evaluate(() => {
    const MIN = 44;
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>(
      "button, a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // Inline links inside a paragraph are text, not touch targets, and are exempt by WCAG 2.5.8.
      if (el.tagName === "A" && el.closest("p")) continue;
      // A checkbox is a 12px box, but tapping its label toggles it — so the label is the real
      // target and its height is the one that has to clear 44px.
      const label = el.closest("label");
      if (label && label.getBoundingClientRect().height >= MIN - 0.5) continue;
      if (r.height < MIN - 0.5) {
        out.push(`${el.tagName}[${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}] h=${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

test("every interactive control meets the 44px touch minimum", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();

  const undersized = await undersizedControls(page);

  expect(undersized, `controls below 44px tall: ${undersized.join(", ")}`).toEqual([]);
});

test("controls inside the new task dialog meet the 44px touch minimum", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  await expect(page.locator("dialog[open]")).toBeVisible();

  const undersized = await undersizedControls(page);

  expect(undersized, `controls below 44px tall: ${undersized.join(", ")}`).toEqual([]);
});

test("controls on the workspaces screen meet the 44px touch minimum", async ({ page }) => {
  await page.goto("/workspaces");
  await expect(page.getByRole("heading", { name: "All Workspaces" })).toBeVisible();

  const undersized = await undersizedControls(page);

  expect(undersized, `controls below 44px tall: ${undersized.join(", ")}`).toEqual([]);
});

test("settings is reachable from the nav on a phone", async ({ page }) => {
  // Settings has no entry in NavLinks and its only other link is the user's name, which is hidden
  // below the sm breakpoint — so on a phone there was no route to it, push settings included.
  await page.goto("/tasks");

  await page.getByRole("link", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings/);
});

test("a long task title is fully readable, not clipped to an ellipsis", async ({ page }) => {
  await page.goto("/tasks");
  const title = page.getByText(/Renew the household contents insurance/);
  await expect(title).toBeVisible();

  const clipped = await title.evaluate((el) => {
    // line-clamp truncation shows as scrollHeight exceeding the clamped clientHeight.
    return el.scrollHeight - el.clientHeight > 2;
  });
  expect(clipped, "task title is truncated at this viewport").toBe(false);
});

test("nothing on the task row overlaps the title", async ({ page }) => {
  await page.goto("/tasks");
  const row = page.getByText("Overdue: pay the water bill");
  await expect(row).toBeVisible();

  const overlaps = await page.evaluate(() => {
    const titles = [...document.querySelectorAll<HTMLElement>("p.line-clamp-2")];
    const bad: string[] = [];
    for (const t of titles) {
      const tr = t.getBoundingClientRect();
      const row = t.closest(".group");
      if (!row) continue;
      for (const btn of row.querySelectorAll<HTMLElement>("button")) {
        const br = btn.getBoundingClientRect();
        const intersects =
          tr.left < br.right - 1 && tr.right > br.left + 1 && tr.top < br.bottom - 1 && tr.bottom > br.top + 1;
        if (intersects) bad.push(`${t.textContent?.slice(0, 20)} / ${btn.getAttribute("aria-label")}`);
      }
    }
    return bad;
  });

  expect(overlaps, `overlapping row elements: ${overlaps.join("; ")}`).toEqual([]);
});
