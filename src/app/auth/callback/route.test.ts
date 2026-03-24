import { resolveNext } from "./resolve-next";

describe("resolveNext", () => {
  const origin = "http://localhost:3000";

  it("returns /tasks when next is absent", () => {
    expect(resolveNext(null, origin)).toBe("/tasks");
  });

  it("returns decoded path for valid same-origin next", () => {
    const encoded = encodeURIComponent("/login?mode=reset");
    expect(resolveNext(encoded, origin)).toBe("/login?mode=reset");
  });

  it("rejects external URL", () => {
    const encoded = encodeURIComponent("https://evil.com/steal");
    expect(resolveNext(encoded, origin)).toBe("/tasks");
  });

  it("rejects protocol-relative URL", () => {
    const encoded = encodeURIComponent("//evil.com");
    expect(resolveNext(encoded, origin)).toBe("/tasks");
  });

  it("falls back on malformed input", () => {
    expect(resolveNext(":::invalid", origin)).toBe("/tasks");
  });
});
