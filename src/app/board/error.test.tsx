import { fireEvent, render, screen } from "@testing-library/react";

import BoardError from "./error";

it("retries by refetching the segment", () => {
  const unstable_retry = jest.fn();
  render(<BoardError error={new Error("boom")} unstable_retry={unstable_retry} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(unstable_retry).toHaveBeenCalled();
});
