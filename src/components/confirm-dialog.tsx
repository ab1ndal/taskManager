"use client";

import { Dialog } from "@/components/dialog";

interface ConfirmDialogProps {
  open: boolean;
  /** Used for the heading's id, so each instance labels its own dialog. */
  id: string;
  title: React.ReactNode;
  body: React.ReactNode;
  confirmLabel: string;
  confirmAriaLabel: string;
  cancelAriaLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for a destructive action. Extracted from the task-delete dialog when leaving a
 * workspace needed the same treatment — that action used to fire on a single click with no
 * confirmation at all, which is worse than deleting a task since it affects shared data.
 */
export function ConfirmDialog({
  open,
  id,
  title,
  body,
  confirmLabel,
  confirmAriaLabel,
  cancelAriaLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      initialFocusSelector="[data-cancel-button]"
      ariaLabelledBy={id}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-6 w-full max-w-sm max-h-[90dvh] overflow-y-auto backdrop:bg-[var(--color-scrim)]"
    >
      <h3 id={id} className="text-base font-semibold mb-2">
        {title}
      </h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">{body}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-cancel-button
          onClick={onCancel}
          aria-label={cancelAriaLabel}
          className="min-h-11 px-4 py-2 text-sm rounded-sm border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          aria-label={confirmAriaLabel}
          className="min-h-11 px-4 py-2 text-sm font-medium rounded-sm bg-[var(--color-danger-solid)] text-[var(--color-text-on-solid)] hover:bg-[var(--color-danger-solid-hover)] transition-colors"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
