import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowMenu } from "../row-menu";

const items = [
  { label: "Edit", onSelect: jest.fn(), icon: <span aria-hidden="true" /> },
  { label: "Reopen", onSelect: jest.fn(), icon: <span aria-hidden="true" /> },
  { label: "Delete", onSelect: jest.fn(), icon: <span aria-hidden="true" />, danger: true },
];

function renderMenu() {
  return render(<RowMenu label='More actions for "Task"' items={items} />);
}

describe("RowMenu", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens on click with the first item focused", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  // The component renders role="menu"/role="menuitem", so assistive tech announces a menu and the
  // arrow keys have to work. Tab used to be the only way between items.
  it("moves between items with the arrow keys, wrapping at both ends", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Reopen" })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();

    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("jumps to the first and last item with Home and End", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("holds a single tab stop", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));

    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("menuitem", { name: "Reopen" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("tabindex", "-1");
  });

  it("opens on ArrowUp from the trigger with the last item focused", async () => {
    renderMenu();
    screen.getByRole("button", { name: /more actions/i }).focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("runs the item's action and closes on selection", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(items[1].onSelect).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
