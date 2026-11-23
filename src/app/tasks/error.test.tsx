import { fireEvent, render, screen } from "@testing-library/react";

import TasksError from "./error";

it("retries by refetching the segment", () => {
  const unstable_retry = jest.fn();
  render(<TasksError error={new Error("boom")} unstable_retry={unstable_retry} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(unstable_retry).toHaveBeenCalled();
});
