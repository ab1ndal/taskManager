import { toLocalInputValue, defaultFirstRun, APP_TIME_ZONE } from "./recurrence-time";

describe("toLocalInputValue", () => {
  it("renders an instant as Pacific wall-clock time", () => {
    // 2026-07-30T16:00Z is 09:00 PDT.
    expect(toLocalInputValue("2026-07-30T16:00:00Z")).toBe("2026-07-30T09:00");
  });

  it("uses PST, not PDT, in winter", () => {
    // 2026-12-30T17:00Z is 09:00 PST.
    expect(toLocalInputValue("2026-12-30T17:00:00Z")).toBe("2026-12-30T09:00");
  });

  it("does not shift the date when local time is behind UTC midnight", () => {
    // 2026-07-31T02:00Z is 2026-07-30 19:00 PDT — the previous day locally.
    expect(toLocalInputValue("2026-07-31T02:00:00Z")).toBe("2026-07-30T19:00");
  });
});

describe("defaultFirstRun", () => {
  it("is tomorrow at 09:00 local", () => {
    expect(defaultFirstRun(new Date("2026-07-30T16:00:00Z"))).toBe("2026-07-31T09:00");
  });

  it("does not skip a day across the spring-forward boundary", () => {
    // 2026-03-08T07:30Z is 2026-03-07 23:30 PST (DST starts 2026-03-08 02:00 local). A fixed 24h
    // add would land past DST and skip to 03-09 instead of 03-08.
    expect(defaultFirstRun(new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08T09:00");
  });

  it("does not repeat today across the fall-back boundary", () => {
    // 2026-11-01T07:30Z is 2026-11-01 00:30 PDT (DST ends 2026-11-01 02:00 local). A fixed 24h
    // add would land short of the clock's extra hour and propose today instead of 11-02.
    expect(defaultFirstRun(new Date("2026-11-01T07:30:00Z"))).toBe("2026-11-02T09:00");
  });
});

describe("APP_TIME_ZONE", () => {
  it("is the one the database functions use", () => {
    expect(APP_TIME_ZONE).toBe("America/Los_Angeles");
  });
});
