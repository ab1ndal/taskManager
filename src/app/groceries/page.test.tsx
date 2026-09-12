import GroceriesPage from "./page";

const query = { select: jest.fn(), eq: jest.fn(), in: jest.fn() };
const client = { auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) }, from: jest.fn(() => query) };
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => client,
  getUser: async () => client.auth.getUser(),
}));
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

it("loads stock from batches and preserves unknown aggregate quantities", async () => {
  query.eq.mockResolvedValueOnce({ data: [{ workspaces: { id: "home", kind: "household" } }], error: null });
  query.eq.mockResolvedValueOnce({ data: [{ id: "milk", name: "Milk", category: "dairy", needed: true, times_added: 2 }], error: null });
  query.in.mockResolvedValueOnce({ data: [
    { id: "old", item_id: "milk", quantity: 2, expires_on: "2026-09-12", expiry_is_estimate: false, created_at: "2026-09-01" },
    { id: "new", item_id: "milk", quantity: null, expires_on: null, expiry_is_estimate: false, created_at: "2026-09-07" },
  ], error: null });
  const page = await GroceriesPage({ searchParams: Promise.resolve({ view: "stock" }) });
  expect(page.props.children.props.items[0]).toMatchObject({ inStock: true, needed: true, quantity: null, expiresOn: "2026-09-12" });
  expect(page.props.children.props.items[0].lots).toHaveLength(2);
});
it("surfaces batch query failures instead of pretending the pantry is empty", async () => {
  query.eq.mockResolvedValueOnce({ data: [{ workspaces: { id: "home", kind: "household" } }], error: null });
  query.eq.mockResolvedValueOnce({ data: [{ id: "milk" }], error: null });
  query.in.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
  await expect(GroceriesPage({ searchParams: Promise.resolve({ view: "stock" }) })).rejects.toThrow("Could not load grocery batches");
});
