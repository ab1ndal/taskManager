import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { Dialog } from "../dialog";

beforeAll(() => {
  // jsdom does not implement showModal(); mock it so we can assert it was called.
  HTMLDialogElement.prototype.showModal = jest.fn();
  HTMLDialogElement.prototype.close = jest.fn();
});

describe("Dialog", () => {
  it("renders a dialog with aria-labelledby from the ariaLabelledBy prop", () => {
    render(
      <Dialog open onClose={jest.fn()} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
      "aria-labelledby",
      "dialog-title"
    );
  });

  it("calls showModal() on mount", () => {
    render(
      <Dialog open onClose={jest.fn()} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("focuses the element matched by initialFocusSelector after mount", () => {
    render(
      <Dialog
        open
        onClose={jest.fn()}
        ariaLabelledBy="dialog-title"
        initialFocusSelector="input[type=text]"
      >
        <h3 id="dialog-title">Title</h3>
        <input type="text" placeholder="Task title" />
      </Dialog>
    );
    expect(screen.getByPlaceholderText("Task title")).toHaveFocus();
  });

  it("calls onClose when the native close event fires", () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    fireEvent(dialogEl, new Event("close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking the dialog element itself (backdrop)", () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    // A real backdrop click presses and releases on the dialog itself.
    fireEvent.mouseDown(dialogEl);
    fireEvent.click(dialogEl);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when clicking a child element inside the dialog", () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    fireEvent.mouseDown(screen.getByText("Title"));
    fireEvent.click(screen.getByText("Title"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // Selecting text in a field and releasing over the dialog's own padding produces a click whose
  // target is the dialog element. Closing on that threw away the user's edits mid-copy.
  it("does not call onClose when a drag starts inside the content and ends on the dialog", () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
        <textarea defaultValue="text to select" />
      </Dialog>
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    fireEvent.mouseDown(screen.getByRole("textbox", { hidden: true }));
    fireEvent.mouseUp(dialogEl);
    fireEvent.click(dialogEl);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when a drag starts on the dialog and ends inside the content", () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    fireEvent.mouseDown(dialogEl);
    fireEvent.click(screen.getByText("Title"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // A save in flight: closing would unmount the dialog, so a failure had nowhere to show its error
  // and a success ran its follow-up against state the user had already left.
  it("ignores a backdrop click while not dismissible", () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title" dismissible={false}>
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    fireEvent.mouseDown(dialogEl);
    fireEvent.click(dialogEl);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels the native cancel event (Escape, iOS dismiss) while not dismissible", () => {
    render(
      <Dialog open onClose={jest.fn()} ariaLabelledBy="dialog-title" dismissible={false}>
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog", { hidden: true }), cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("lets the native cancel event through by default", () => {
    render(
      <Dialog open onClose={jest.fn()} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog", { hidden: true }), cancel);
    expect(cancel.defaultPrevented).toBe(false);
  });

  it("closes on a backdrop click again once dismissible", () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title" dismissible={false}>
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    rerender(
      <Dialog open onClose={onClose} ariaLabelledBy="dialog-title" dismissible>
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    fireEvent.mouseDown(dialogEl);
    fireEvent.click(dialogEl);
    expect(onClose).toHaveBeenCalled();
  });

  it("has no axe violations for a minimal labelled render", async () => {
    const { container } = render(
      <Dialog open onClose={jest.fn()} ariaLabelledBy="dialog-title">
        <h3 id="dialog-title">Title</h3>
      </Dialog>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
