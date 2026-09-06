"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BUILD_ID } from "@/lib/build-id";
import { reloadPage } from "@/lib/reload-page";

/** Resumes closer together than this re-use the last check; app switching is bursty. */
const MIN_INTERVAL_MS = 10_000;

/**
 * Reloading mid-sentence loses work, so a pending deploy waits for a resume that finds the app
 * idle. There is always another resume: iOS foregrounds a standalone app every time it is opened.
 */
export function isSafeToReload(doc: Document): boolean {
  if (doc.querySelector("dialog[open]")) return false;

  const active = doc.activeElement;
  if (!active) return true;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return false;
  return active instanceof HTMLElement && active.isContentEditable ? false : true;
}

/**
 * Keeps an installed iOS web app current on resume.
 *
 * iOS suspends a standalone web app rather than killing it, so a home-screen launch usually
 * restores a JS context that has been parked for hours: its task list is whatever the last fetch
 * returned, and its code is whatever was deployed when it first loaded. Neither corrects itself
 * without a navigation, and the app is a single screen the user rarely navigates away from.
 *
 * `router.refresh()` handles the data. Code needs the build-id comparison: the service worker
 * cannot signal a deploy, because `sw.js` is byte-identical across builds and its
 * `controllerchange` never fires, and this project is on a plan without Vercel's Skew Protection.
 * A stale client is not merely out of date — Server Actions encrypt their arguments with a
 * build-derived key, so calling one against a newer deployment fails outright.
 *
 * Both `visibilitychange` and `pageshow` are observed. Which of them a home-screen resume fires on
 * current iOS is not documented either way, and the widely-cited claim that iOS reloads standalone
 * apps on every foreground dates from before iOS 13.
 */
export function ResumeRefresh() {
  const router = useRouter();
  const lastCheck = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastCheck.current < MIN_INTERVAL_MS) return;
      lastCheck.current = now;

      router.refresh();

      try {
        const response = await fetch("/api/build-id", { cache: "no-store" });
        // An expired session redirects this to the login page, which is HTML. Treat anything that
        // is not the JSON we asked for as "no answer" rather than as a deploy.
        if (!response.ok) return;
        const { buildId } = await response.json();
        if (cancelled || typeof buildId !== "string") return;

        if (buildId !== BUILD_ID && isSafeToReload(document)) {
          reloadPage();
        }
      } catch {
        // Offline or a failed fetch is not a deploy. The next resume checks again.
      }
    }

    const onPageShow = () => void check();
    document.addEventListener("visibilitychange", onPageShow);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onPageShow);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}
