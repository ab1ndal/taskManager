"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";

type Toast = {
  id: number;
  message: string;
  type: "success" | "warning" | "error";
};

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
    function handler(e: Event) {
      const { message, type } = (e as CustomEvent<{ message: string; type: Toast["type"] }>).detail;
      const id = Date.now();
      if (type === "error") {
        setAssertiveToasts((prev) => [...prev, { id, message, type }]);
        return;
      }
      setPoliteToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(
        () => setPoliteToasts((prev) => prev.filter((t) => t.id !== id)),
        3500
      );
    }
    window.addEventListener("app:toast", handler);
    return () => window.removeEventListener("app:toast", handler);
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
