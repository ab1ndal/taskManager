import { knownGroceryRpcFailure } from "./rpc-errors";

it("forwards a message the migration raises", () => {
  expect(knownGroceryRpcFailure("grocery item abc not found")).toBe("grocery item abc not found");
  expect(knownGroceryRpcFailure("grocery item abc has no quantity to adjust")).not.toBeNull();
  expect(knownGroceryRpcFailure("member m is not in workspace w")).not.toBeNull();
  expect(knownGroceryRpcFailure("p_target must be stock or list")).toBeNull();
});

it("withholds anything we did not author", () => {
  expect(knownGroceryRpcFailure('relation "grocery_items" does not exist')).toBeNull();
  expect(knownGroceryRpcFailure("permission denied for schema private")).toBeNull();
  expect(
    knownGroceryRpcFailure('new row violates check constraint "grocery_items_qty_positive"'),
  ).toBeNull();
});
