"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { TAB20_SLUGS, type Tab20Slug } from "@/app/board/colors";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";

/**
 * The twenty tab20 swatches, as a radiogroup rather than a listbox: picking a colour is choosing
 * one of a fixed set, and radios give keyboard users arrow-key traversal for free.
 *
 * The selected swatch also carries a check glyph, not just a border ring — several tab20 pairs
 * (blue/cyan, orange/brown) sit close enough in hue that a colour-only "which one is picked" signal
 * would fail a colour-vision-deficient user.
 */
export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: Tab20Slug;
  onChange: (slug: Tab20Slug) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-transparent p-1.5 hover:border-[var(--color-border)]"
      >
        <span
          className="block h-6 w-6 rounded-full ring-1 ring-inset ring-black/10"
          style={{ background: `var(--color-${value})` }}
        />
      </button>

      {open && (
        <div
          role="radiogroup"
          aria-label={label}
          className="absolute left-0 top-full z-10 mt-1 grid grid-cols-5 gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-xl"
        >
          {TAB20_SLUGS.map((slug) => {
            const selected = slug === value;
            return (
              <button
                key={slug}
                type="button"
                role="radio"
                aria-label={slug}
                aria-checked={selected}
                onClick={() => {
                  onChange(slug);
                  setOpen(false);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-inset ring-black/10"
                style={{ background: `var(--color-${slug})` }}
              >
                {selected && (
                  <Check
                    size={ICON_SECONDARY}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                    className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
