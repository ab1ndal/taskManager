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
    fireEvent.click(screen.getByText("Title"));
    expect(onClose).not.toHaveBeenCalled();
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
