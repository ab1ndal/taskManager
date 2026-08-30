import { knownRpcFailure } from "./rpc-errors";

it("passes through a message matching one of our authored fragments", () => {
  const message = "column e0000000-0000-4000-8000-00000000000a changed since it was listed";
  expect(knownRpcFailure(message)).toBe(message);
});

it("passes through the last-non-terminal-column message", () => {
  const message = "cannot delete the last non-terminal column of workspace a0000000-0000-4000-8000-000000000001";
  expect(knownRpcFailure(message)).toBe(message);
});

it("returns null for an arbitrary Postgres error we did not author", () => {
  expect(knownRpcFailure("permission denied for table board_columns")).toBeNull();
  expect(
    knownRpcFailure(
      'insert or update on table "tasks" violates foreign key constraint "tasks_board_column_id_fkey"'
    )
  ).toBeNull();
  expect(knownRpcFailure('invalid input syntax for type uuid: "not-a-uuid"')).toBeNull();
});
