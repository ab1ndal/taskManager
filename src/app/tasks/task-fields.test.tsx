import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { TaskFields } from "./task-fields";
import type { RecurrenceValue } from "./recurrence-time";

jest.mock("@/lib/use-dictation", () => ({
  useDictation: () => ({ stop: jest.fn(), field: null, claim: jest.fn(), supported: false }),
}));

const workspaces = [
  { id: "w1", name: "Household", kind: "household", members: [{ id: "m1", display_name: "Alice" }] },
];

function setup(overrides: Partial<React.ComponentProps<typeof TaskFields>> = {}) {
  const onRecurrenceChange = jest.fn();
  const { recurrence: initialRecurrence = null, ...restOverrides } = overrides;
  const props = {
    idPrefix: "new-task" as const,
    title: "Take trash",
    onTitleChange: jest.fn(),
    description: "",
    onDescriptionChange: jest.fn(),
    dueAt: "",
    onDueAtChange: jest.fn(),
    workspaces,
    workspaceId: "w1",
    onWorkspaceChange: jest.fn(),
    selectedMemberIds: ["m1"],
    onToggleMember: jest.fn(),
    disabled: false,
    dictation: { stop: jest.fn(), field: null, claim: jest.fn(), supported: false },
    ...restOverrides,
  } as Omit<React.ComponentProps<typeof TaskFields>, "recurrence" | "onRecurrenceChange">;

  // TaskFields is fully controlled and holds no state of its own, so a spy that never feeds a
  // value back in leaves every keystroke fighting React's own controlled-input restoration (it
  // resets the DOM to the last-committed prop the instant an event's value doesn't match it) —
  // real usage never hits this because the parent modal's setState always closes the loop. This
  // wrapper is that parent: it applies each change to state, in addition to recording it on the
  // spy the assertions read.
  function Harness() {
    const [recurrence, setRecurrence] = useState<RecurrenceValue | null>(initialRecurrence);
    return (
      <TaskFields
        {...props}
        recurrence={recurrence}
        onRecurrenceChange={(next) => {
          onRecurrenceChange(next);
          setRecurrence(next);
        }}
      />
    );
  }

  render(<Harness />);
  return { onRecurrenceChange };
}

describe("Repeats", () => {
  it("is off when the task has no recurrence", () => {
    setup();
    expect(screen.getByLabelText("Repeats")).not.toBeChecked();
    expect(screen.queryByLabelText("Repeat every")).not.toBeInTheDocument();
  });

  it("switching it on proposes a daily rule starting tomorrow at 09:00", async () => {
    const { onRecurrenceChange } = setup();
    await userEvent.click(screen.getByLabelText("Repeats"));

    expect(onRecurrenceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "daily",
        intervalCount: 1,
        firstRunAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T09:00$/),
      })
    );
  });

  it("switching it off clears the recurrence", async () => {
    const { onRecurrenceChange } = setup({
      recurrence: { frequency: "daily", intervalCount: 3, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    await userEvent.click(screen.getByLabelText("Repeats"));
    expect(onRecurrenceChange).toHaveBeenCalledWith(null);
  });

  it("shows the schedule when it is on", () => {
    setup({
      recurrence: { frequency: "weekly", intervalCount: 2, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    expect(screen.getByLabelText("Repeat every")).toHaveValue(2);
    expect(screen.getByLabelText("Repeat unit")).toHaveValue("weekly");
    expect(screen.getByLabelText("Starting")).toHaveValue("2026-07-30T09:00");
  });

  it("offers no biweekly unit, because that is weekly every 2", () => {
    setup({
      recurrence: { frequency: "weekly", intervalCount: 1, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    const units = Array.from(screen.getByLabelText("Repeat unit").querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(units).toEqual(["daily", "weekly", "monthly"]);
  });

  it("reports an interval change without dropping the rest of the rule", async () => {
    const { onRecurrenceChange } = setup({
      recurrence: { frequency: "daily", intervalCount: 1, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    await userEvent.clear(screen.getByLabelText("Repeat every"));
    await userEvent.type(screen.getByLabelText("Repeat every"), "3");

    expect(onRecurrenceChange).toHaveBeenLastCalledWith({
      frequency: "daily",
      intervalCount: 3,
      firstRunAt: "2026-07-30T09:00",
      dueOffsetHours: null,
    });
  });

  it("has no accessibility violations with the section open", async () => {
    const { container } = render(<div />);
    setup({
      recurrence: { frequency: "daily", intervalCount: 3, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    // "region" flags this fragment for not being wrapped in a landmark, which is a property of
    // the modal `<form>` it mounts inside in real use, not of this section — checked here in
    // isolation, so the rule has nothing to check against and is disabled for this assertion.
    expect(
      await axe(container.ownerDocument.body, { rules: { region: { enabled: false } } })
    ).toHaveNoViolations();
  });
});
