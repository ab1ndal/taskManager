import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({ usePathname: () => "/groceries" }));

import { NavLinks } from "../nav-links";

it("links to groceries and no longer to workspaces", () => {
  render(<NavLinks />);
  expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("href", "/groceries");
  expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();
});

it("marks the current section", () => {
  render(<NavLinks />);
  expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("aria-current", "page");
});

it("keeps the bar to three destinations", () => {
  render(<NavLinks />);
  expect(screen.getAllByRole("link")).toHaveLength(3);
});
