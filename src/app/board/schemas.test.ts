import { parseInput, ValidationError } from "@/app/tasks/schemas";
import {
  createBoardColumnSchema,
  deleteBoardColumnSchema,
  moveTaskToColumnSchema,
  renameBoardColumnSchema,
  setBoardColumnColorSchema,
} from "./schemas";

const WS = "a0000000-0000-4000-8000-000000000001";
const COL = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const TASK = "c0000000-0000-4000-8000-000000000001";
const MEMBER = "b0000000-0000-4000-8000-000000000001";

describe("createBoardColumnSchema", () => {
  it("accepts a trimmed name and a tab20 slug", () => {
    expect(
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "  Waiting  ", color: "tab20-cyan" })
    ).toEqual({ workspaceId: WS, name: "Waiting", color: "tab20-cyan" });
  });

  it("rejects a blank name", () => {
    expect(() =>
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "   ", color: "tab20-cyan" })
    ).toThrow(ValidationError);
  });

  it("rejects a name over 40 characters, matching the database constraint", () => {
    expect(() =>
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "x".repeat(41), color: "tab20-cyan" })
    ).toThrow(/40 characters/);
  });

  it("rejects a hex colour", () => {
    expect(() =>
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "Waiting", color: "#1f77b4" })
    ).toThrow(ValidationError);
  });
});

describe("renameBoardColumnSchema", () => {
  it("keeps the id and the trimmed name", () => {
    expect(parseInput(renameBoardColumnSchema, { columnId: COL, name: " Parked " })).toEqual({
      columnId: COL,
      name: "Parked",
    });
  });
});

describe("setBoardColumnColorSchema", () => {
  it("rejects a slug that is not in the palette", () => {
    expect(() =>
      parseInput(setBoardColumnColorSchema, { columnId: COL, color: "tab20-chartreuse" })
    ).toThrow(ValidationError);
  });
});

describe("moveTaskToColumnSchema", () => {
  it("accepts null neighbour keys, which mean an empty destination", () => {
    expect(
      parseInput(moveTaskToColumnSchema, {
        taskId: TASK,
        columnId: COL,
        memberId: MEMBER,
        prevKey: null,
        nextKey: null,
      })
    ).toEqual({ taskId: TASK, columnId: COL, memberId: MEMBER, prevKey: null, nextKey: null });
  });

  it("rejects a non-numeric neighbour key", () => {
    expect(() =>
      parseInput(moveTaskToColumnSchema, {
        taskId: TASK,
        columnId: COL,
        memberId: MEMBER,
        prevKey: "1000",
        nextKey: null,
      })
    ).toThrow(ValidationError);
  });
});

describe("deleteBoardColumnSchema", () => {
  it("accepts an empty moves array, which means an empty column", () => {
    expect(parseInput(deleteBoardColumnSchema, { columnId: COL, moves: [] })).toEqual({
      columnId: COL,
      moves: [],
    });
  });

  it("accepts one destination per task", () => {
    const input = { columnId: COL, moves: [{ taskId: TASK, targetColumnId: COL_B }] };
    expect(parseInput(deleteBoardColumnSchema, input)).toEqual(input);
  });

  it("rejects a move whose destination is the column being deleted", () => {
    expect(() =>
      parseInput(deleteBoardColumnSchema, { columnId: COL, moves: [{ taskId: TASK, targetColumnId: COL }] })
    ).toThrow(/different column/);
  });

  it("rejects the same task twice", () => {
    expect(() =>
      parseInput(deleteBoardColumnSchema, {
        columnId: COL,
        moves: [
          { taskId: TASK, targetColumnId: COL_B },
          { taskId: TASK, targetColumnId: COL_B },
        ],
      })
    ).toThrow(/once/);
  });

  it("rejects a move whose task id is not a uuid", () => {
    expect(() =>
      parseInput(deleteBoardColumnSchema, {
        columnId: COL,
        moves: [{ taskId: "not-a-uuid", targetColumnId: COL_B }],
      })
    ).toThrow(ValidationError);
  });

  it("rejects a move whose target column id is not a uuid", () => {
    expect(() =>
      parseInput(deleteBoardColumnSchema, {
        columnId: COL,
        moves: [{ taskId: TASK, targetColumnId: "not-a-uuid" }],
      })
    ).toThrow(ValidationError);
  });
});
