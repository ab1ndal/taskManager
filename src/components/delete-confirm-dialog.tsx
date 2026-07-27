"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";

interface DeleteConfirmDialogProps {
  open: boolean;
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Task-specific wording over the shared confirmation shell. */
export function DeleteConfirmDialog({
  open,
  taskTitle,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      id="delete-confirm-title"
      title={<>Delete &quot;{taskTitle}&quot;?</>}
      body="This cannot be undone."
      confirmLabel="Delete"
      confirmAriaLabel={`Confirm delete "${taskTitle}"`}
      cancelAriaLabel="Cancel delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
