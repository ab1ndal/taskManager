import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import SettingsPage from "./page";

const mockRedirect = jest.fn((url: string) => {
  // Mirrors Next's real redirect(): it interrupts rendering by throwing, which Next's router
  // catches internally. Tests assert on this throw plus the call, since nothing here has a
  // router to actually navigate.
  throw new Error(`REDIRECT:${url}`);
});

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ refresh: jest.fn() }),
  redirect: (url: string) => mockRedirect(url),
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

beforeEach(() => {
  mockRedirect.mockClear();
});

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

it("redirects to the profile tab for an unknown tab value", async () => {
  // Mutation this catches: reverting to the old content-only fallback (rendering Profile while
  // leaving `tab=nonsense` in the URL) instead of normalising the URL itself — that mutation
  // would make this reject expectation fail because SettingsPage would resolve instead of throw,
  // and mockRedirect would never be called.
  await expect(
    SettingsPage({ searchParams: Promise.resolve({ tab: "nonsense" }) })
  ).rejects.toThrow("REDIRECT:/settings?tab=profile");
  expect(mockRedirect).toHaveBeenCalledTimes(1);
  expect(mockRedirect).toHaveBeenCalledWith("/settings?tab=profile");
});

it("redirects to the profile tab for an empty tab value", async () => {
  // Mutation this catches: a guard that only checks falsiness loosely (e.g. `if (tab && tab !==
  // "profile" && tab !== "board")`) would treat `tab=` (present but empty) as falsy and skip the
  // redirect, silently rendering Profile while leaving the invalid `?tab=` in the URL.
  await expect(
    SettingsPage({ searchParams: Promise.resolve({ tab: "" }) })
  ).rejects.toThrow("REDIRECT:/settings?tab=profile");
  expect(mockRedirect).toHaveBeenCalledWith("/settings?tab=profile");
});

it("does not redirect for the bare /settings URL", async () => {
  // Mutation this catches: widening the redirect condition to fire on `tab === undefined` too
  // (e.g. dropping the `tab !== undefined` guard), which would send a plain /settings visit into
  // a redirect loop instead of rendering Profile directly.
  await renderPage("");

  expect(mockRedirect).not.toHaveBeenCalled();
  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

it("does not redirect for a recognised tab value, so a typo'd tab heals in one hop", async () => {
  // Mutation this catches: narrowing the allow-list check to only `!== "profile"` (forgetting
  // `board`), which would send every ?tab=board visit into an infinite redirect loop back to
  // itself since "board" !== "profile".
  await renderPage("tab=profile");
  await renderPage("tab=board");

  expect(mockRedirect).not.toHaveBeenCalled();
});

it("has no accessibility violations", async () => {
  const { container } = await renderPage("");
  await screen.findByRole("heading", { name: "Profile" });

  expect(await axe(container)).toHaveNoViolations();
});
