import { test, expect } from "@playwright/test";

/**
 * Phone-shaped checks. These matter twice over: the site is used on phones, and the same build is
 * the iPhone deliverable, installed to the home screen and running standalone inside a notched
 * safe area with no browser chrome to absorb mistakes.
 */

// The `iphone` project already supplies the device descriptor; running these under the desktop
// projects would just repeat the same assertions against the wrong viewport.
test.describe("iPhone", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "iPhone project only");
  });

  test("text inputs are at least 16px, so iOS does not zoom on focus", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const small = await page.evaluate(() => {
      const out: string[] = [];
      const fields = document.querySelectorAll<HTMLElement>("input, select, textarea");
      for (const f of fields) {
        const r = f.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (f instanceof HTMLInputElement && ["checkbox", "radio", "hidden"].includes(f.type)) continue;
        const size = parseFloat(getComputedStyle(f).fontSize);
        // Mobile Safari zooms the viewport when a focused field's text is under 16px, and never
        // zooms back out. Every text-entry control has to clear it.
        if (size < 16) out.push(`${f.tagName}[${f.getAttribute("placeholder") ?? f.getAttribute("aria-label") ?? f.id}] ${size}px`);
      }
      return out;
    });

    expect(small, `fields under 16px trigger iOS zoom: ${small.join(", ")}`).toEqual([]);
  });

  test("the viewport declares safe-area support", async ({ page }) => {
    await page.goto("/tasks");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport, "viewport meta").toContain("viewport-fit=cover");
  });

  test("the app is installable to the home screen", async ({ page }) => {
    await page.goto("/tasks");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref, "no web app manifest — cannot install to the home screen").toBeTruthy();

    const res = await page.request.get(manifestHref!);
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBeTruthy();
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy();

    // Home-screen launches on iOS read the apple-touch-icon, not the manifest icons.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });

  test("fixed chrome clears the notch and the home indicator", async ({ page }) => {
    await page.goto("/tasks");
    const nav = page.locator("nav").first();
    await expect(nav).toBeVisible();

    const padding = await nav.evaluate((el) => {
      const style = getComputedStyle(el);
      return { top: style.paddingTop, left: style.paddingLeft };
    });
    // env(safe-area-inset-*) resolves to 0 in a non-standalone browser context, so this asserts the
    // declaration exists rather than a specific pixel value.
    const usesSafeArea = await page.evaluate(() => {
      const sheets = [...document.styleSheets];
      return sheets.some((sheet) => {
        try {
          return [...sheet.cssRules].some((r) => r.cssText.includes("safe-area-inset"));
        } catch {
          return false;
        }
      });
    });
    expect(usesSafeArea, `no safe-area-inset anywhere in the stylesheet (nav padding ${padding.top}/${padding.left})`).toBe(true);
  });

  test("the task row fits the phone: every control tappable, title readable", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();

    const report = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".group")];
      return rows.map((row) => {
        const title = row.querySelector<HTMLElement>("p");
        const buttons = [...row.querySelectorAll<HTMLElement>("button")].filter(
          (b) => b.getBoundingClientRect().width > 0
        );
        return {
          title: title?.textContent?.slice(0, 24) ?? "",
          titleWidth: title ? Math.round(title.getBoundingClientRect().width) : 0,
          buttons: buttons.length,
          overflowRight: Math.max(
            0,
            ...buttons.map((b) => Math.round(b.getBoundingClientRect().right - window.innerWidth))
          ),
        };
      });
    });

    for (const row of report) {
      expect(row.overflowRight, `${row.title}: controls run past the right edge`).toBeLessThanOrEqual(0);
      // A title squeezed under ~140px on a 393px screen is the "Renew t…" failure.
      expect(row.titleWidth, `${row.title}: title column is only ${row.titleWidth}px`).toBeGreaterThan(150);
    }
  });

  test("the tab strip scrolls rather than overflowing the page", async ({ page }) => {
    await page.goto("/tasks");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
