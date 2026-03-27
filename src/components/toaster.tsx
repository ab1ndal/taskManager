"use client";

import { useEffect, useState } from "react";

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

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const { message, type } = (e as CustomEvent<{ message: string; type: Toast["type"] }>).detail;
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        3500
      );
    }
    window.addEventListener("app:toast", handler);
    return () => window.removeEventListener("app:toast", handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-xs rounded-lg px-4 py-2.5 text-sm text-white shadow-lg transition-all ${
            t.type === "error" ? "bg-red-600" : t.type === "warning" ? "bg-amber-500" : "bg-gray-900"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
