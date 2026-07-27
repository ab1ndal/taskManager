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
 *
 * It announces itself as a menu, so it behaves like one: the ARIA APG menu-button pattern gives the
 * menu a single tab stop and moves between items with the arrow keys. Tab used to be the only way
 * through, which is what a plain group of buttons does — not what `role="menu"` promises.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  // Which item holds the menu's single tab stop. -1 while closed.
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  function openMenu(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function closeMenu({ focusTrigger }: { focusTrigger: boolean }) {
    setOpen(false);
    setActiveIndex(-1);
    if (focusTrigger) triggerRef.current?.focus();
  }

  // Focus follows the active item for as long as the menu is open — including the first paint after
  // it opens, which is why this runs on `open` as well as on the index.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu({ focusTrigger: false });
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu({ focusTrigger: true });
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(items.length - 1);
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    // Wrapping, per the APG: Down on the last item lands on the first.
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === "Tab") {
      // Tab leaves the menu rather than walking it: the menu is one tab stop.
      closeMenu({ focusTrigger: false });
    }
  }

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu({ focusTrigger: false }) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
        className="w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
      >
        <MoreVertical size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-11 z-20 min-w-[10rem] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                closeMenu({ focusTrigger: false });
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
