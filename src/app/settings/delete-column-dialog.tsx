import type { BoardColumn } from "@/app/board/group-columns";

/** Props accepted so callers typecheck; unused because the placeholder never renders anything. */
export type DeleteColumnDialogProps = {
  column: BoardColumn;
  onClose: () => void;
  onDeleted: () => void;
};

// Placeholder so column-row.tsx compiles and this task's tests can render `ColumnRow` without a
// real confirmation flow. Task 13 replaces this wholesale with the destination-picking dialog.
export function DeleteColumnDialog(props: DeleteColumnDialogProps) {
  void props;
  return null;
}
