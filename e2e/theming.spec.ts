import { test, expect, type Page } from "@playwright/test";

/**
 * The 6.5 contrast work was arithmetic on token values. This measures what a browser actually
 * painted, which is how the invisible complete-circle survived the first pass: the script only
 * checked text pairs, and a control outline is not text.
 */

function relativeLuminance([r, g, b]: number[]) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrast(a: number[], b: number[]) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parseRgb(value: string): number[] | null {
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return null;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  if (parts.length > 3 && parts[3] === 0) return null; // fully transparent — nothing painted
  return parts.slice(0, 3);
}

/** Walks up for the first ancestor that actually paints a background. */
async function collectPairs(page: Page) {
  return page.evaluate(() => {
    function effectiveBg(el: Element): string {
      let node: Element | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !/rgba?\([^)]*,\s*0\)$/.test(bg) && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    }

    const out: { label: string; fg: string; bg: string; size: number; bold: boolean }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = n.textContent?.trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      out.push({
        label: text.slice(0, 40),
        fg: style.color,
        bg: effectiveBg(el),
        size: parseFloat(style.fontSize),
        bold: Number(style.fontWeight) >= 700,
      });
    }
    return out;
  });
}

/** Every text node currently painted, measured against what is behind it. */
async function contrastFailures(page: Page): Promise<string[]> {
  const failures: string[] = [];
  for (const pair of await collectPairs(page)) {
    const fg = parseRgb(pair.fg);
    const bg = parseRgb(pair.bg);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    const large = pair.size >= 24 || (pair.bold && pair.size >= 18.66);
    const min = large ? 3 : 4.5;
    if (ratio < min) failures.push(`"${pair.label}" ${ratio.toFixed(2)}:1 (needs ${min})`);
  }
  return failures;
}

/**
 * The walk used to run on `/tasks` only, and never with a dialog open — which is exactly where
 * `--color-surface-sunken` and the status tokens are used. Each surface below is measured in both
 * schemes.
 *
 * `/login` needs a signed-out context: the proxy redirects a signed-in user away from it.
 */
const SURFACES = [
  {
    name: "/tasks",
    open: async (page: Page) => {
      await page.goto("/tasks");
      await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
    },
  },
  {
    name: "/workspaces",
    open: async (page: Page) => {
      await page.goto("/workspaces");
      await expect(page.locator("main")).toBeVisible();
    },
  },
  {
    name: "/profile",
    open: async (page: Page) => {
      await page.goto("/profile");
      await expect(page.locator("main")).toBeVisible();
    },
  },
  {
    name: "the new-task dialog",
    open: async (page: Page) => {
      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    // The sunken Updates and Subtasks panels only exist here.
    name: "the edit-task dialog",
    open: async (page: Page) => {
      await page.goto("/tasks");
      const title = "Today: take the bins out";
      const direct = page.getByRole("button", { name: `Edit "${title}"` });
      if (await direct.isVisible()) await direct.click();
      else {
        await page.getByRole("button", { name: `More actions for "${title}"` }).click();
        await page.getByRole("menuitem", { name: "Edit" }).click();
      }
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Wait for the update thread so its timestamps and author names are measured too.
      await expect(dialog.getByText("Second Member").first()).toBeVisible();
    },
  },
  {
    name: "the delete confirmation",
    open: async (page: Page) => {
      await page.goto("/tasks");
      const title = "Overdue: pay the water bill";
      const direct = page.getByRole("button", { name: `Delete "${title}"` });
      if (await direct.isVisible()) await direct.click();
      else {
        await page.getByRole("button", { name: `More actions for "${title}"` }).click();
        await page.getByRole("menuitem", { name: "Delete" }).click();
      }
      await expect(page.getByRole("button", { name: /^Confirm delete/ })).toBeVisible();
    },
  },
] as const;

for (const scheme of ["light", "dark"] as const) {
  for (const surface of SURFACES) {
    test(`${surface.name} clears WCAG AA in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await surface.open(page);

      const failures = await contrastFailures(page);
      expect(
        failures,
        `contrast failures on ${surface.name} in ${scheme}: ${failures.join(" | ")}`
      ).toEqual([]);
    });
  }

  test(`/login clears WCAG AA in ${scheme} mode`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });

    await page.goto("/login");
    await expect(page.locator("form").getByRole("button", { name: "Sign in" })).toBeVisible();

    const failures = await contrastFailures(page);
    await context.close();

    expect(failures, `contrast failures on /login in ${scheme}: ${failures.join(" | ")}`).toEqual([]);
  });
}

test("reduced motion collapses every transition and animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();

  const moving = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const s = getComputedStyle(el);
      const durations = [...s.transitionDuration.split(","), ...s.animationDuration.split(",")];
      for (const d of durations) {
        const ms = d.trim().endsWith("ms") ? parseFloat(d) : parseFloat(d) * 1000;
        if (ms > 1) {
          out.push(`${el.tagName}.${el.className?.toString().slice(0, 30)} ${d.trim()}`);
          break;
        }
      }
    }
    return out.slice(0, 5);
  });

  expect(moving, `animation still running under prefers-reduced-motion: ${moving.join(", ")}`).toEqual([]);
});

test("keyboard focus is visible on every control", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();

  const seen = new Set<string>();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        id: `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)}`,
        outlineWidth: parseFloat(s.outlineWidth),
        outlineStyle: s.outlineStyle,
      };
    });
    if (!info) continue;
    if (seen.has(info.id)) break;
    seen.add(info.id);
    expect(
      info.outlineWidth >= 1 && info.outlineStyle !== "none",
      `no focus outline on ${info.id}`
    ).toBe(true);
  }

  expect(seen.size, "keyboard tabbing reached nothing").toBeGreaterThan(3);
});
