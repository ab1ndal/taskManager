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
 */
export function useForegroundRefresh(intervalMs = 20_000): void {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => router.refresh(), intervalMs);
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
