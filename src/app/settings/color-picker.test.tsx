import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { TAB20_SLUGS } from "@/app/board/colors";
import { ColorPicker } from "./color-picker";

it("offers all twenty palette colours once opened", async () => {
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(screen.getAllByRole("radio")).toHaveLength(TAB20_SLUGS.length);
});

it("marks the current colour as selected", async () => {
  render(<ColorPicker value="tab20-cyan" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(screen.getByRole("radio", { name: "tab20-cyan", checked: true })).toBeInTheDocument();
});

it("reports the chosen colour and closes", async () => {
  const onChange = jest.fn();
  render(<ColorPicker value="tab20-blue" onChange={onChange} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-olive" }));

  expect(onChange).toHaveBeenCalledWith("tab20-olive");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});

it("closes on Escape without reporting a change", async () => {
  const onChange = jest.fn();
  render(<ColorPicker value="tab20-blue" onChange={onChange} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.keyboard("{Escape}");

  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("has no accessibility violations when open", async () => {
  const { container } = render(
    <ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />
  );
  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(await axe(container)).toHaveNoViolations();
});

it("focuses the currently selected swatch when opened", async () => {
  // Mutation this catches: opening without moving focus at all (focus stays on the trigger) or
  // always focusing the first swatch regardless of `value` — either fails this exact-swatch check.
  render(<ColorPicker value="tab20-olive" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(screen.getByRole("radio", { name: "tab20-olive" })).toHaveFocus();
});

it("keeps only the active swatch in the tab order", async () => {
  // Mutation this catches: dropping the roving `tabIndex` (back to every swatch being a tab stop) —
  // this would leave all twenty radios at tabIndex 0 instead of exactly one.
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  const radios = screen.getAllByRole("radio");
  const tabbable = radios.filter((r) => r.getAttribute("tabindex") === "0");
  expect(tabbable).toHaveLength(1);
  expect(tabbable[0]).toHaveAccessibleName("tab20-blue");
});

it("moves focus right and down through the grid with arrow keys", async () => {
  // Mutation this catches: arrow keys doing nothing (the pre-fix behaviour) — focus would stay on
  // tab20-blue instead of moving, failing both assertions below.
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "tab20-blue-light" })).toHaveFocus();

  await userEvent.keyboard("{ArrowDown}");
  // Five columns wide: one row down from index 1 (blue-light) is index 6 (red).
  expect(screen.getByRole("radio", { name: "tab20-red" })).toHaveFocus();
});

it("jumps to the first and last swatch on Home and End", async () => {
  // Mutation this catches: Home/End not wired (falls through the switch's default case) — focus
  // would stay wherever arrow keys last left it instead of jumping to an edge.
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("radio", { name: "tab20-cyan-light" })).toHaveFocus();

  await userEvent.keyboard("{Home}");
  expect(screen.getByRole("radio", { name: "tab20-blue" })).toHaveFocus();
});

it("returns focus to the trigger on Escape", async () => {
  // Mutation this catches: closing on Escape without refocusing the trigger — the pre-fix behaviour
  // dropped focus to document.body, which this distinguishes from by asserting the trigger
  // specifically has focus, not just that the popover closed.
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  const trigger = screen.getByRole("button", { name: "Colour for In Progress" });
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");

  expect(trigger).toHaveFocus();
});

it("returns focus to the trigger after picking a colour", async () => {
  // Mutation this catches: closing on pick without refocusing the trigger, leaving a keyboard user's
  // focus on a now-unmounted swatch button (effectively dropped to document.body).
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  const trigger = screen.getByRole("button", { name: "Colour for In Progress" });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("radio", { name: "tab20-olive" }));

  expect(trigger).toHaveFocus();
});
