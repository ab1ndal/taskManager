"use client";

import { useEffect, useRef } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  initialFocusSelector?: string;
  ariaLabelledBy?: string;
  className?: string;
  children: React.ReactNode;
}

export function Dialog({
  onClose,
  initialFocusSelector,
  ariaLabelledBy,
  className,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    dialogEl.showModal();

    if (initialFocusSelector) {
      const target = dialogEl.querySelector<HTMLElement>(initialFocusSelector);
      target?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby={ariaLabelledBy}
      className={
        className ??
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto backdrop:bg-[var(--color-scrim)]"
      }
    >
      {children}
    </dialog>
  );
}
