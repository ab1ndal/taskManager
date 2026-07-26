"use client";

import { Dialog } from "@/components/dialog";

interface DeleteConfirmDialogProps {
  open: boolean;
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  open,
  taskTitle,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      initialFocusSelector="[data-cancel-button]"
      ariaLabelledBy="delete-confirm-title"
      className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto backdrop:bg-black/40"
    >
      <h3 id="delete-confirm-title" className="text-base font-semibold mb-2">
        Delete &quot;{taskTitle}&quot;?
      </h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">This cannot be undone.</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-cancel-button
          onClick={onCancel}
          aria-label="Cancel delete"
          className="min-h-11 px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          aria-label={`Confirm delete "${taskTitle}"`}
          className="min-h-11 px-4 py-2 text-sm font-medium rounded-[8px] bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          Delete
        </button>
      </div>
    </Dialog>
  );
}
