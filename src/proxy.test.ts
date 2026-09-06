/**
 * @jest-environment node
 *
 * The manifest must stay reachable without a session. Browsers fetch `/manifest.webmanifest` with
 * credentials omitted, so the Supabase cookie is never sent and an authenticated-only manifest
 * redirects to /login on every install — silently dropping `display: standalone`, `start_url` and
 * the icon list.
 */
import { NextRequest } from "next/server";

const getUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { proxy } from "./proxy";

function request(path: string) {
  return new NextRequest(new URL(`https://hearth.test${path}`));
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("proxy", () => {
  it("serves the manifest to a signed-out request", async () => {
    const response = await proxy(request("/manifest.webmanifest"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects a signed-out request for an app route", async () => {
    const response = await proxy(request("/tasks"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hearth.test/login");
  });

  it("serves the service worker to a signed-out request", async () => {
    const response = await proxy(request("/sw.js"));

    expect(response.status).toBe(200);
  });
});
