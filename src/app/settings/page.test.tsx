import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import SettingsPage from "./page";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: "a@b.c", user_metadata: { name: "Alice" } } } }),
      updateUser: async () => ({ error: null }),
    },
  }),
}));

jest.mock("./board-tab", () => ({ BoardTab: () => <div>Board tab content</div> }));

let mockSearch = "";

async function renderPage(search: string) {
  mockSearch = search;
  return render(await SettingsPage({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) }));
}

it("shows both tabs", async () => {
  await renderPage("");

  expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Board" })).toBeInTheDocument();
});

it("defaults to the profile tab", async () => {
  await renderPage("");

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  expect(screen.queryByText("Board tab content")).not.toBeInTheDocument();
});

it("shows the board tab when asked", async () => {
  await renderPage("tab=board");

  expect(await screen.findByText("Board tab content")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Profile" })).not.toBeInTheDocument();
});

it("falls back to the profile tab for an unknown tab value", async () => {
  await renderPage("tab=nonsense");

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  expect(screen.queryByText("Board tab content")).not.toBeInTheDocument();
});

it("has no accessibility violations", async () => {
  const { container } = await renderPage("");
  await screen.findByRole("heading", { name: "Profile" });

  expect(await axe(container)).toHaveNoViolations();
});
