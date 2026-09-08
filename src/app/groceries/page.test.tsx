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
