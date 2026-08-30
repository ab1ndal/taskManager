"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { TAB20_SLUGS, type Tab20Slug } from "@/app/board/colors";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";

const LAST_INDEX = TAB20_SLUGS.length - 1;
/** Grid is 5 columns wide; arrow-key math below is in terms of this. */
const COLUMNS = 5;

/**
 * The twenty tab20 swatches, as a radiogroup rather than a listbox: picking a colour is choosing
 * one of a fixed set.
 *
 * Keyboard model is roving tabindex, the same pattern native `input[type=radio]` groups get for
 * free and a `role="radio"` `<button>` does not: only the active swatch is a tab stop, arrow keys
 * (plus Home/End) move that focus around the grid, the popover opens with the current colour
 * already focused, and focus returns to the trigger both on Escape and after a pick — so a keyboard
 * user is never left with focus dropped to `document.body` or forced through twenty tab stops.
 *
 * The selected swatch also carries a check glyph, not just a border ring — several tab20 pairs
 * (blue/cyan, orange/brown) sit close enough in hue that a colour-only "which one is picked" signal
 * would fail a colour-vision-deficient user. The glyph's own colour follows the slug's `-light`
 * suffix (the actual luminance split baked into the palette — see colors.ts) rather than a single
 * hard-coded white, which would go invisible on the light half of the palette.
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
  const [activeIndex, setActiveIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Opening focuses the currently-selected swatch, matching where a native radio group would put
  // focus on open, rather than leaving it on the trigger or defaulting to the first swatch. The
  // index itself is set from the click handler that opens the popover (below), not from an effect
  // — setting state synchronously inside an effect just to derive it from a prop is the antipattern
  // react-hooks/set-state-in-effect flags. This effect only performs the imperative DOM focus, once
  // the swatch button for that index actually exists in the tree.
  useEffect(() => {
    if (!open) return;
    swatchRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
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

  function moveTo(index: number) {
    // The focus-effect above performs the actual `.focus()` call once this commits.
    setActiveIndex(Math.max(0, Math.min(LAST_INDEX, index)));
  }

  function onGroupKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveTo(activeIndex + COLUMNS);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(activeIndex - COLUMNS);
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(LAST_INDEX);
        break;
      default:
        break;
    }
  }

  function pick(slug: Tab20Slug) {
    onChange(slug);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={container} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() =>
          setOpen((prev) => {
            const next = !prev;
            if (next) setActiveIndex(TAB20_SLUGS.indexOf(value));
            return next;
          })
        }
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
          onKeyDown={onGroupKeyDown}
          className="absolute left-0 top-full z-10 mt-1 grid grid-cols-5 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-xl"
        >
          {TAB20_SLUGS.map((slug, index) => {
            const selected = slug === value;
            const isLight = slug.endsWith("-light");
            return (
              <button
                key={slug}
                ref={(el) => {
                  swatchRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-label={slug}
                aria-checked={selected}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => pick(slug)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full ring-1 ring-inset ring-black/10"
                style={{ background: `var(--color-${slug})` }}
              >
                {selected && (
                  <Check
                    size={ICON_SECONDARY}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                    className={
                      isLight
                        ? "text-black/80"
                        : "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                    }
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
