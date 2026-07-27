"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  icon: React.ReactNode;
  danger?: boolean;
};

/**
 * A phone-width task row cannot hold four 44px controls and a readable title: drag, complete, edit
 * and delete plus padding took 244px of 393px, which is what truncated titles to "Renew t…". The
 * two secondary actions collapse behind this menu below `sm`; above it they stay on the row, where
 * there is room and a hover state to de-emphasise them with.
 *
 * Deliberately not a `<dialog>`: this sits inside task rows that can themselves open one, and a
 * second modal layer for a two-item menu is the wrong weight. It closes on Escape, on outside
 * pointer-down, and on selection, and returns focus to its trigger.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
      >
        <MoreVertical size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-11 z-20 min-w-[10rem] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2 min-h-11 px-3 rounded-sm text-sm text-left transition-colors hover:bg-[var(--color-accent-subtle)] ${
                item.danger ? "text-[var(--color-danger-text)]" : "text-[var(--color-text-primary)]"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
