import type { BoardColumn } from "@/app/board/group-columns";

// Placeholder so column-row.tsx compiles and this task's tests can render `ColumnRow` without a
// real confirmation flow. Task 13 replaces this wholesale with the destination-picking dialog.
export function DeleteColumnDialog(_props: {
  column: BoardColumn;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return null;
}
