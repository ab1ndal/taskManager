import { computeNeighborKeys } from "./reorder-helpers";

describe("computeNeighborKeys", () => {
  const bucket = [
    { member_sort_key: 1000 },
    { member_sort_key: 2000 },
    { member_sort_key: 3000 },
  ];

  it("returns null prevKey when dropped at the start", () => {
    // dragged item is now at index 0; bucket[1] (2000) is the new next neighbor
    const result = computeNeighborKeys(
      [{ member_sort_key: -1 }, ...bucket.slice(1)],
      0
    );
    expect(result).toEqual({ prevKey: null, nextKey: 2000 });
  });

  it("returns null nextKey when dropped at the end", () => {
    const arr = [...bucket.slice(0, 2), { member_sort_key: -1 }];
    const result = computeNeighborKeys(arr, 2);
    expect(result).toEqual({ prevKey: 2000, nextKey: null });
  });

  it("returns both neighbors when dropped in the middle", () => {
    const arr = [bucket[0], { member_sort_key: -1 }, bucket[2]];
    const result = computeNeighborKeys(arr, 1);
    expect(result).toEqual({ prevKey: 1000, nextKey: 3000 });
  });

  it("returns null/null for a single-item bucket", () => {
    const result = computeNeighborKeys([{ member_sort_key: -1 }], 0);
    expect(result).toEqual({ prevKey: null, nextKey: null });
  });
});
