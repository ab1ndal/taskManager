import { test, expect, type Page } from "@playwright/test";

/**
 * Layout facts that only exist once a real engine has done layout: overflow, landmark count,
 * element overlap, and whether a control is actually reachable at the viewport it ships on.
 */

const PAGES = ["/tasks", "/workspaces", "/profile"];

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth > 1;
  });
}

for (const path of PAGES) {
  test(`${path} does not scroll horizontally`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test(`${path} has exactly one main landmark`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toHaveCount(1);
  });
}

test("every interactive control meets the 44px touch minimum", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();

  const undersized = await page.evaluate(() => {
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
      if (r.height < MIN - 0.5) {
        out.push(`${el.tagName}[${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}] h=${Math.round(r.height)}`);
      }
    }
    return out;
  });

  expect(undersized, `controls below 44px tall: ${undersized.join(", ")}`).toEqual([]);
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
