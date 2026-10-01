"use client";

import { useRef, useState, useTransition } from "react";

import { toast } from "@/components/toaster";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { addGroceryItem } from "./actions";
import { AddStockDialog } from "./add-stock-dialog";
import { type CategorySlug } from "./categories";
import { DictateSheet } from "./dictate-sheet";
import type { GroceryItem } from "./types";
import { suggestNames } from "./suggest";

/** Rapid name entry. Shopping adds save at once; pantry adds open AddStockDialog for the amount. */
export function AddRow({
  workspaceId,
  items,
  target,
}: {
  workspaceId: string;
  items: GroceryItem[];
  target: "stock" | "list";
}) {
  const [name, setName] = useState("");
  const [stocking, setStocking] = useState<{ name: string; category: CategorySlug | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestNames(items, name);

  // A suggestion passes its own category; a typed name is matched against every loaded product,
  // archived ones included, so a re-add shows the category it will keep.
  function submit(value: string, knownCategory?: CategorySlug) {
    const trimmed = value.trim();
    if (pending || trimmed === "") return;

    if (target === "stock") {
      const match = items.find((item) => item.name.trim().toLowerCase() === trimmed.toLowerCase());
      setStocking({ name: match?.name ?? trimmed, category: knownCategory ?? match?.category ?? null });
      return;
    }

    startTransition(async () => {
      try {
        const result = await addGroceryItem({ workspaceId, name: trimmed, target });

        if (!result.ok) {
          toast(result.error, "error");
          return;
        }

        setName("");
        inputRef.current?.focus();
      } catch (error) {
        // A rejected call (dropped connection, mid-flight navigation) used to vanish silently.
        console.error("grocery action call rejected", error);
        toast(GENERIC_ERROR, "error");
      }
    });
  }

  // A fragment, not a wrapper: `sticky` only sticks within its parent, so the bar has to be a direct
  // child of the tall list container. Only the name field, Add and the suggestions stay pinned —
  // dictation scrolls away, because on a phone the pinned block used to cover over half the screen
  // and leave the list a strip at the bottom. It pins below the nav, which is itself
  // sticky at top-0 and stacked above: pinned at top-0 too, the bar slid underneath it.
  return (
    <>
      <div className="sticky top-[calc(var(--nav-height)+env(safe-area-inset-top))] z-10 bg-(--color-bg) px-3 py-2 border-b border-(--color-border)">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(name);
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Add an item"
            placeholder={target === "list" ? "Add to the list" : "Add to the pantry"}
            autoComplete="off"
            enterKeyHint="done"
            className="block w-full min-w-0 flex-1 min-h-11 px-3 rounded-lg border border-(--color-border) bg-(--color-surface) text-base"
          />
          <button
            type="submit"
            disabled={pending || name.trim() === ""}
            className="shrink-0 inline-flex items-center min-h-11 px-4 rounded-full bg-(--color-accent) text-(--color-text-on-accent) text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {suggestions.length > 0 && (
          <ul className="mt-2 flex gap-2 overflow-x-auto">
            {suggestions.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => submit(item.name, item.category)}
                  className="shrink-0 inline-flex items-center min-h-11 px-3 rounded-full bg-(--color-surface-sunken) text-xs"
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-3 py-2">
        <DictateSheet workspaceId={workspaceId} target={target} />
      </div>

      {stocking && (
        <AddStockDialog
          workspaceId={workspaceId}
          name={stocking.name}
          category={stocking.category}
          onClose={() => setStocking(null)}
          onAdded={() => {
            setStocking(null);
            setName("");
            inputRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
