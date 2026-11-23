"use client";

import { useEffect, useRef } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  initialFocusSelector?: string;
  ariaLabelledBy?: string;
  className?: string;
  /** False while a save is in flight: backdrop clicks and Escape / the iOS dismiss gesture are
   *  ignored, so the dialog stays mounted to show the save's error or run its success path. */
  dismissible?: boolean;
  children: React.ReactNode;
}

export function Dialog({
  onClose,
  initialFocusSelector,
  ariaLabelledBy,
  className,
  dismissible = true,
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

  // Where the press started. A click on a native <dialog> reports the dialog element as its target
  // both for a real backdrop click and for the end of a text selection that began in a field and
  // released over the dialog's own padding — so the click target alone cannot tell them apart, and
  // selecting text to copy used to dismiss the modal. Requiring the press and the release to have
  // both landed on the dialog separates the two.
  const pressTarget = useRef<EventTarget | null>(null);

  const handleMouseDown = (event: React.MouseEvent<HTMLDialogElement>) => {
    pressTarget.current = event.target;
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    const startedOnDialog = pressTarget.current === dialogRef.current;
    pressTarget.current = null;
    if (dismissible && event.target === dialogRef.current && startedOnDialog) {
      onClose();
    }
  };

  // Escape and the iOS dismiss gesture fire a cancelable `cancel` before the native close.
  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    if (!dismissible) event.preventDefault();
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={handleCancel}
      onMouseDown={handleMouseDown}
      onClick={handleBackdropClick}
      aria-labelledby={ariaLabelledBy}
      className={
        className ??
        "rounded-lg border border-(--color-border) bg-(--color-surface) shadow-xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto backdrop:bg-(--color-scrim)"
      }
    >
      {children}
    </dialog>
  );
}
