import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast, Toaster } from "@/components/toaster";

describe("Toaster", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("renders both live regions on mount, empty, before any toast fires", () => {
    render(<Toaster />);

    const status = screen.getByRole("status");
    const alert = screen.getByRole("alert");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(status).toBeEmptyDOMElement();
    expect(alert).toBeEmptyDOMElement();
  });

  it("routes a success toast into the polite status region", () => {
    render(<Toaster />);

    act(() => {
      toast("Task created", "success");
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Task created");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("routes an error toast into the assertive alert region", () => {
    render(<Toaster />);

    act(() => {
      toast("Failed to save", "error");
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed to save");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("auto-dismisses a success toast after 3500ms", () => {
    render(<Toaster />);

    act(() => {
      toast("Task created", "success");
    });

    expect(screen.getByRole("status")).toHaveTextContent("Task created");

    act(() => {
      jest.advanceTimersByTime(3500);
    });

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("does not auto-dismiss an error toast", () => {
    render(<Toaster />);

    act(() => {
      toast("Failed to save", "error");
    });

    act(() => {
      jest.advanceTimersByTime(3500);
    });
    act(() => {
      jest.advanceTimersByTime(60000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to save");
  });

  it("renders a 44px dismiss button with a type-scoped aria-label that removes the toast on click", () => {
    render(<Toaster />);

    act(() => {
      toast("Failed to save", "error");
    });

    const dismissButton = screen.getByRole("button", { name: "Close error message" });
    expect(dismissButton.className).toContain("w-11");
    expect(dismissButton.className).toContain("h-11");

    fireEvent.click(dismissButton);

    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
