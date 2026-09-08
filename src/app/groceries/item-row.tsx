"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, ListPlus, Minus, Plus, Trash2, X } from "lucide-react";

import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { RowMenu } from "@/components/row-menu";
import { toast } from "@/components/toaster";
import { GENERIC_ERROR, type ActionResult } from "@/app/tasks/action-result";
import { adjustQuantity, editItem, finishItem, forgetItem, markBought, setNeeded } from "./actions";
import { addDays, categoryLabel, shelfLifeDays } from "./categories";
import { isExpired } from "./sort";
import { EditItemDialog } from "./edit-item-dialog";
import type { GroceryItem } from "./types";

/**
 * Shared by PantryRow and ShoppingRow: both wrap every action call the same way, so `call` lives
 * once here rather than being copy-pasted per row. It has to live inside a component because it
 * closes over `startTransition`.
 *
 * A rejected `work()` (dropped connection, mid-flight navigation, a server crash) used to be
 * unhandled — no toast, no state change, no log. The try/catch below gives it the same toast a
 * returned `{ ok: false }` gets, and still logs the real error for diagnosis.
 */
function useActionCall() {
  const [pending, startTransition] = useTransition();

  const call = (work: () => Promise<ActionResult>) =>
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) toast(result.error, "error");
      } catch (error) {
        console.error("grocery action call rejected", error);
        toast(GENERIC_ERROR, "error");
      }
    });

  return { pending, call };
}

const CATEGORY_TAG =
  "text-2xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-sunken)] " +
  "text-[var(--color-text-secondary)]";

/**
 * Grocery expiry deliberately avoids the danger/warning/success trio task-card.tsx uses for
 * deadlines: if a bag of spinach turns a row red, red stops meaning "this task is late". Expiry is
 * muted text, and the single loud state — expired — gets the amber surface only.
 */
function ExpiryLine({ item, today }: { item: GroceryItem; today: string }) {
  if (item.expiresOn === null) return null;

  const expired = isExpired(item.expiresOn, today);
  const label = `${item.expiryIsEstimate ? "~" : ""}${item.expiresOn}`;

  return (
    <span className="text-2xs text-[var(--color-text-muted)]">
      {expired ? (
        <span className="font-medium px-2 py-0.5 rounded-full bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]">
          expired
        </span>
      ) : (
        label
      )}
    </span>
  );
}

export function PantryRow({ item, today }: { item: GroceryItem; today: string }) {
  const { pending, call } = useActionCall();
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex items-center gap-3 min-h-11 px-3 py-2 border-b border-[var(--color-border)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium break-words text-[var(--color-text-primary)]">
            {item.name}
          </span>
          <span className={CATEGORY_TAG}>{categoryLabel(item.category)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <ExpiryLine item={item} today={today} />
          {item.expiresOn !== null && isExpired(item.expiresOn, today) && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                call(() =>
                  editItem({
                    itemId: item.id,
                    name: item.name,
                    category: item.category,
                    // A flat week is wrong for most categories — frozen food pushed out by seven
                    // days would read as expired again next week — so the nudge uses the
                    // category's own shelf life, falling back to a week only when a category
                    // carries none.
                    expiresOn: addDays(today, shelfLifeDays(item.category) ?? 7),
                    quantity: item.quantity,
                  }),
                )
              }
              className="min-h-11 text-2xs font-medium text-[var(--color-accent-text)]"
            >
              Still good
            </button>
          )}
          {item.quantity !== null && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`One fewer ${item.name}`}
                disabled={pending}
                onClick={() => call(() => adjustQuantity({ itemId: item.id, delta: -1 }))}
                className="inline-flex items-center justify-center size-11 rounded-full text-[var(--color-text-secondary)]"
              >
                <Minus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />
              </button>
              <span className="text-sm tabular-nums w-5 text-center">{item.quantity}</span>
              <button
                type="button"
                aria-label={`One more ${item.name}`}
                disabled={pending}
                onClick={() => call(() => adjustQuantity({ itemId: item.id, delta: 1 }))}
                className="inline-flex items-center justify-center size-11 rounded-full text-[var(--color-text-secondary)]"
              >
                <Plus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* The low-stock gesture: one tap, no dialog. A dialog here is the step people skip. */}
      <button
        type="button"
        aria-pressed={item.needed}
        disabled={pending}
        onClick={() => call(() => setNeeded({ itemId: item.id, needed: !item.needed }))}
        className={`shrink-0 inline-flex items-center min-h-11 px-3 rounded-full text-xs font-medium ${
          item.needed
            ? "bg-[var(--color-accent)] text-[var(--color-text-on-accent)]"
            : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
        }`}
      >
        Need
      </button>

      <RowMenu
        label={`Actions for ${item.name}`}
        items={[
          { label: "Edit item", onSelect: () => setEditing(true), icon: <Pencil size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" /> },
          {
            label: "Finished — add to list",
            onSelect: () => call(() => finishItem({ itemId: item.id, keepOnList: true })),
            icon: <ListPlus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
          },
          {
            label: "Finished — just remove",
            onSelect: () => call(() => finishItem({ itemId: item.id, keepOnList: false })),
            icon: <Check size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
          },
          {
            label: "Forget this item",
            onSelect: () => call(() => forgetItem({ itemId: item.id })),
            icon: <Trash2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
            danger: true,
          },
        ]}
      />
      {editing && <EditItemDialog item={item} onClose={() => setEditing(false)} />}
    </li>
  );
}

export function ShoppingRow({ item }: { item: GroceryItem }) {
  const { pending, call } = useActionCall();
  const [editing, setEditing] = useState(false);

  return (
    <li className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        {/* The whole row is the target, not just the circle: this is tapped one-handed in a shop. */}
        <button
          type="button"
          aria-label={`Bought ${item.name}`}
          disabled={pending}
          onClick={() => call(() => markBought({ itemId: item.id }))}
          className="flex-1 flex items-center gap-3 min-h-11 px-3 py-2 text-left"
        >
          <span className="shrink-0 inline-flex items-center justify-center size-6 rounded-full border border-[var(--color-control-idle)]">
            {pending && <Check size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium break-words text-[var(--color-text-primary)]">
                {item.name}
              </span>
              <span className={CATEGORY_TAG}>{categoryLabel(item.category)}</span>
            </span>
            {/* What the shopper actually wants at the shelf: how much is already at home. */}
            {item.inStock && item.quantity !== null && (
              <span className="block text-2xs text-[var(--color-text-muted)]">
                have {item.quantity}
              </span>
            )}
          </span>
        </button>

        <RowMenu
          label={`Actions for ${item.name}`}
          items={[
          { label: "Edit item", onSelect: () => setEditing(true), icon: <Pencil size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" /> },
            {
              label: "Remove from list",
              onSelect: () => call(() => setNeeded({ itemId: item.id, needed: false })),
              icon: <X size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
            },
            {
              label: "Forget this item",
              onSelect: () => call(() => forgetItem({ itemId: item.id })),
              icon: <Trash2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
              danger: true,
            },
          ]}
        />
      </div>
      {editing && <EditItemDialog item={item} onClose={() => setEditing(false)} />}
    </li>
  );
}
