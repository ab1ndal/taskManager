"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the server component tree every 20 seconds while the grocery page is foregrounded.
 *
 * Both phones are looking at the same list, and the only freshness the app otherwise has is
 * ResumeRefresh's five-minute poll plus refresh-on-resume — long enough for two people in a shop
 * to buy the same milk. Twenty seconds is inside the time it takes to walk to the next aisle.
 *
 * Deliberately not Supabase Realtime: this repo has no realtime code, and a subscription would add
 * a publication to enable in two projects, a lifecycle to get right across iOS suspend/resume, and
 * a socket-drop failure mode. Revisit if 20 seconds proves too stale in practice.
 *
 * The timer only runs while the document is visible, so a backgrounded standalone app is not
 * polling, and it is cleared on unmount so leaving the page stops the work.
 *
 * Ticks are skipped while the browser reports no connection. A `router.refresh()` whose RSC fetch
 * fails on a network error makes Next fall back to a full-page navigation (`location.replace`),
 * so a shop with no signal would swap the list for the browser's offline error page and lose
 * whatever was being typed. ResumeRefresh refreshes once when the `online` event fires.
 *
 * This is a mitigation, not a guarantee: iOS can report `onLine` as true on a captive portal or a
 * zero-bar connection, and a refresh sent then still falls back to a hard navigation.
 */
export function useForegroundRefresh(intervalMs = 20_000): void {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (navigator.onLine) router.refresh();
      }, intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [router, intervalMs]);
}
