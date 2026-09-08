import GroceriesPage from "./page";

const query = { select: jest.fn(), eq: jest.fn() };
const client = { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from: jest.fn(() => query) };
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(url); }) }));
jest.mock("./groceries-client", () => ({ GroceriesClient: () => null }));

beforeEach(() => { jest.clearAllMocks(); query.select.mockReturnValue(query); });

it("preserves workspace when canonicalizing the view", async () => {
  await expect(GroceriesPage({ searchParams: Promise.resolve({ workspace: "second" }) }))
    .rejects.toThrow("/groceries?view=buy&workspace=second");
});
it("surfaces membership failures", async () => {
  query.eq.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
  await expect(GroceriesPage({ searchParams: Promise.resolve({ view: "buy" }) })).rejects.toThrow("Could not load grocery workspaces");
});
it("surfaces item failures instead of rendering an empty list", async () => {
  query.eq.mockResolvedValueOnce({ data: [{ workspaces: { id: "first", kind: "household" } }], error: null });
  query.eq.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
  await expect(GroceriesPage({ searchParams: Promise.resolve({ view: "buy" }) })).rejects.toThrow("Could not load grocery items");
});

// Regression (Important 1): `workspace ?? households[0]?.id` handed the raw query parameter to the
// item query. A malformed value threw the user to the error boundary, a foreign UUID rendered a
// working-looking page whose every add failed, and a *work* workspace rendered a grocery list —
// which docs/product.md says households own. /board already validates the same parameter.
it("ignores a workspace parameter that is not one of the user's households", async () => {
  query.eq.mockResolvedValueOnce({ data: [{ workspaces: { id: "first", kind: "household" } }], error: null });
  query.eq.mockResolvedValueOnce({ data: [], error: null });

  await GroceriesPage({ searchParams: Promise.resolve({ view: "buy", workspace: "not-a-uuid" }) });

  expect(query.eq).toHaveBeenLastCalledWith("workspace_id", "first");
});

it("ignores a work workspace the user does belong to", async () => {
  query.eq.mockResolvedValueOnce({
    data: [
      { workspaces: { id: "home", kind: "household" } },
      { workspaces: { id: "office", kind: "work" } },
    ],
    error: null,
  });
  query.eq.mockResolvedValueOnce({ data: [], error: null });

  await GroceriesPage({ searchParams: Promise.resolve({ view: "buy", workspace: "office" }) });

  expect(query.eq).toHaveBeenLastCalledWith("workspace_id", "home");
});
