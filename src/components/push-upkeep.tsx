"use client";

import { useEffect } from "react";
import { subscribeToPush } from "@/app/settings/notification-actions";

/**
 * Keeps the push state correct while the app is open, without ever prompting.
 *
 * Two things drift on iOS. The Home Screen badge is set by us and cleared by nobody — iOS does not
 * clear it when the notification is read — so it stays lit until the app opens and clears it. And
 * push endpoints expire: Safari does not reliably fire `pushsubscriptionchange`, so a subscription
 * can quietly stop matching the row stored for it, after which the digest sends to a dead endpoint
 * until the server sees a 404 or 410. Re-upserting whatever subscription the browser currently
 * holds costs one write per open and keeps the stored row honest.
 *
 * Permission is never requested here. `Notification.requestPermission()` needs a user gesture on
 * iOS, so a subscription is only ever re-registered, never created.
 */
export function PushUpkeep() {
  useEffect(() => {
    let cancelled = false;

    async function upkeep() {
      if (document.visibilityState !== "visible") return;

      // Badging resolves independently of the service worker, so clear it even where push is
      // unsupported or was never enabled.
      try {
        await navigator.clearAppBadge?.();
      } catch {
        // Badging is best effort; an unsupported or blocked call is not an error worth surfacing.
      }

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (cancelled || !subscription) return;
        await subscribeToPush(subscription.toJSON());
      } catch {
        // An offline open or a revoked subscription is not actionable here; the settings screen
        // reports the real state and the next open tries again.
      }
    }

    void upkeep();
    const onVisible = () => void upkeep();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
