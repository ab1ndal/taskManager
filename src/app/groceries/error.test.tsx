import { fireEvent, render, screen } from "@testing-library/react";

import GroceriesError from "./error";

// reset() only clears the boundary and re-renders without refetching, so a failed server render
// fails the same way again. unstable_retry() refreshes the route first (Next 16.2 error.js docs).
it("retries by refetching the segment", () => {
  const unstable_retry = jest.fn();
  render(<GroceriesError error={new Error("boom")} unstable_retry={unstable_retry} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(unstable_retry).toHaveBeenCalled();
});
