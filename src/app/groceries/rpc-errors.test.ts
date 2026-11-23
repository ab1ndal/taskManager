import { knownGroceryRpcFailure } from "./rpc-errors";

it("forwards a message the migration raises", () => {
  expect(knownGroceryRpcFailure("grocery item abc not found")).toBe("grocery item abc not found");
  expect(knownGroceryRpcFailure("grocery item abc has no quantity to adjust")).not.toBeNull();
  expect(knownGroceryRpcFailure("member m is not in workspace w")).not.toBeNull();
  expect(knownGroceryRpcFailure("p_target must be stock or list")).toBeNull();
});

it("replaces a stale-version conflict with an instruction instead of the raw message", () => {
  expect(knownGroceryRpcFailure("grocery_conflict: lot abc is at version 3, caller loaded 2"))
    .toBe("Changed on the other phone — reopen to see the latest.");
});

it("withholds anything we did not author", () => {
  expect(knownGroceryRpcFailure('relation "grocery_items" does not exist')).toBeNull();
  expect(knownGroceryRpcFailure("permission denied for schema private")).toBeNull();
  expect(
    knownGroceryRpcFailure('new row violates check constraint "grocery_items_qty_positive"'),
  ).toBeNull();
});
