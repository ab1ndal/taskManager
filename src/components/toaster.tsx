"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";

type Toast = {
  id: string;
  message: string;
  type: "success" | "warning" | "error";
};

/**
 * Errors linger far longer than confirmations — they carry something the user has to read and act
 * on — but they no longer stay forever. An error that only the close button could clear meant a
 * failed action from ten minutes ago was still stacked on screen.
 */
const DISMISS_MS: Record<Toast["type"], number> = {
  success: 3500,
  warning: 6000,
  error: 10000,
};

/** Beyond this, the oldest toast in a lane is dropped rather than growing the stack off-screen. */
const MAX_PER_LANE = 3;

// Call from any client component: toast("message") or toast("message", "error") or toast("message", "warning")
export function toast(message: string, type: "success" | "warning" | "error" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app:toast", { detail: { message, type } })
  );
}

/**
 * Fill and text move together. The status fills keep their value across themes so their text stays
 * white, while the neutral toast rides the inverse surface, which does flip — a single shared text
 * colour would go unreadable on one of the two.
 */
const toastSurfaces: Record<Toast["type"], string> = {
  error: "bg-[var(--color-danger-solid)] text-[var(--color-text-on-solid)]",
  warning: "bg-[var(--color-warning-solid)] text-[var(--color-text-on-solid)]",
  success: "bg-[var(--color-inverse-surface)] text-[var(--color-inverse-text)]",
};

function toastClasses(type: Toast["type"]) {
  return `max-w-xs rounded-sm pl-4 pr-1 py-1 text-sm shadow-lg transition-all flex items-center gap-2 ${toastSurfaces[type]}`;
}

export function Toaster() {
  const [politeToasts, setPoliteToasts] = useState<Toast[]>([]);
  const [assertiveToasts, setAssertiveToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    function handler(e: Event) {
      const { message, type } = (e as CustomEvent<{ message: string; type: Toast["type"] }>).detail;
      // Was `Date.now()`, which collides when two toasts fire in the same millisecond — two React
      // children with the same key.
      const id = crypto.randomUUID();
      const setLane = type === "error" ? setAssertiveToasts : setPoliteToasts;

      setLane((prev) => [...prev, { id, message, type }].slice(-MAX_PER_LANE));

      const timer = setTimeout(() => {
        timers.delete(timer);
        setLane((prev) => prev.filter((t) => t.id !== id));
      }, DISMISS_MS[type]);
      timers.add(timer);
    }

    window.addEventListener("app:toast", handler);
    return () => {
      window.removeEventListener("app:toast", handler);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col gap-2">
        {politeToasts.map((t) => (
          <div key={t.id} className={toastClasses(t.type)}>
            <span className="py-1.5">{t.message}</span>
            <button
              type="button"
              onClick={() => setPoliteToasts((prev) => prev.filter((x) => x.id !== t.id))}
              aria-label={`Close ${t.type} message`}
              className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-sm hover:bg-current/15 transition-colors"
            >
              <X size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="flex flex-col gap-2">
        {assertiveToasts.map((t) => (
          <div key={t.id} className={toastClasses(t.type)}>
            <span className="py-1.5">{t.message}</span>
            <button
              type="button"
              onClick={() => setAssertiveToasts((prev) => prev.filter((x) => x.id !== t.id))}
              aria-label={`Close ${t.type} message`}
              className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-sm hover:bg-current/15 transition-colors"
            >
              <X size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
