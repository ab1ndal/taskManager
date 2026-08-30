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
