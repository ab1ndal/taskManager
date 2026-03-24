import { render, screen } from "@testing-library/react";
import { Avatar } from "../avatar";

describe("Avatar", () => {
  it("shows first letter of name as initials", () => {
    render(<Avatar name="Alice" email="alice@example.com" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("falls back to email initial when name is empty", () => {
    render(<Avatar name="" email="bob@example.com" />);
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("has accessible aria-label", () => {
    render(<Avatar name="Alice" email="alice@example.com" />);
    expect(screen.getByLabelText("Avatar for Alice")).toBeInTheDocument();
  });

  it("applies large size class when size=lg", () => {
    const { container } = render(<Avatar name="Alice" email="" size="lg" />);
    expect(container.firstChild).toHaveClass("w-14");
  });
});
