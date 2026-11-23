"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Tells the user why the list has stopped updating: refreshes are skipped while offline (see
 * useForegroundRefresh), so what is on screen is the last list the server sent.
 *
 * The live region is always mounted so screen readers announce the message when it appears. The
 * server render assumes online, which is the only state a server-rendered page can arrive in.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

  return (
    <div role="status" className="px-3">
      {!online && (
        <p className="flex items-center gap-2 pb-2 text-xs text-(--color-text-secondary)">
          <WifiOff size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0" />
          No signal — showing your last list
        </p>
      )}
    </div>
  );
}
