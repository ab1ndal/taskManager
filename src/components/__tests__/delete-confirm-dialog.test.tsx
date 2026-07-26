import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { DeleteConfirmDialog } from "../delete-confirm-dialog";

beforeAll(() => {
  // jsdom does not implement showModal(); mock it so we can assert it was called.
  HTMLDialogElement.prototype.showModal = jest.fn();
  HTMLDialogElement.prototype.close = jest.fn();
});

describe("DeleteConfirmDialog", () => {
  it("focuses the Cancel button on mount, not Delete", () => {
    render(
      <DeleteConfirmDialog
        open
        taskTitle="Buy milk"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Cancel delete" })).toHaveFocus();
  });

  it('calls onConfirm when clicking "Confirm delete" button', () => {
    const onConfirm = jest.fn();
    render(
      <DeleteConfirmDialog
        open
        taskTitle="Buy milk"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: 'Confirm delete "Buy milk"' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when clicking "Cancel delete" button', () => {
    const onCancel = jest.fn();
    render(
      <DeleteConfirmDialog
        open
        taskTitle="Buy milk"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel delete" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders both buttons with min-h-11 (44px minimum height)", () => {
    render(
      <DeleteConfirmDialog
        open
        taskTitle="Buy milk"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Cancel delete" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: 'Confirm delete "Buy milk"' })).toHaveClass(
      "min-h-11"
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <DeleteConfirmDialog
        open
        taskTitle="Buy milk"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
