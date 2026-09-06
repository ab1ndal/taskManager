import { render, waitFor } from "@testing-library/react";
import { ResumeRefresh, isSafeToReload } from "../resume-refresh";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// BUILD_ID resolves to "development" under jest, so any other value stands for a new deployment.
const reload = jest.fn();
jest.mock("@/lib/reload-page", () => ({ reloadPage: () => reload() }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

function answerWith(buildId: string, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: async () => ({ buildId }),
  }) as unknown as typeof fetch;
}

function resume() {
  document.dispatchEvent(new Event("visibilitychange"));
}

function pageShow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent & { persisted: boolean };
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("isSafeToReload", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is unsafe while a dialog is open", () => {
    document.body.innerHTML = "<dialog open></dialog>";

    expect(isSafeToReload(document)).toBe(false);
  });

  it("is unsafe while a text field has focus", () => {
    document.body.innerHTML = '<input id="title" />';
    document.querySelector<HTMLInputElement>("#title")!.focus();

    expect(isSafeToReload(document)).toBe(false);
  });

  it("is safe on an idle page", () => {
    document.body.innerHTML = "<p>tasks</p>";

    expect(isSafeToReload(document)).toBe(true);
  });
});

describe("ResumeRefresh", () => {
  it("refreshes task data on resume", async () => {
    answerWith("development");
    render(<ResumeRefresh />);

    resume();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("reloads when the running deployment differs", async () => {
    answerWith("a-newer-commit-sha");
    render(<ResumeRefresh />);

    resume();

    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("does not reload when the deployment is unchanged", async () => {
    answerWith("development");
    render(<ResumeRefresh />);

    resume();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves a new deployment alone while a dialog is open", async () => {
    answerWith("a-newer-commit-sha");
    document.body.innerHTML = "<dialog open></dialog>";
    render(<ResumeRefresh />);

    resume();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
    document.body.innerHTML = "";
  });

  it("checks once for resumes in quick succession", async () => {
    answerWith("development");
    render(<ResumeRefresh />);

    resume();
    resume();
    resume();

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("treats a login redirect as no answer rather than a deploy", async () => {
    answerWith("a-newer-commit-sha", false);
    render(<ResumeRefresh />);

    resume();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it("survives a failed fetch while offline", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    render(<ResumeRefresh />);

    resume();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });
});

it("keeps checking while the app is left open in the foreground", async () => {
  jest.useFakeTimers();
  answerWith("development");
  render(<ResumeRefresh />);

  resume();
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

  // Past both the throttle and the poll interval.
  jest.advanceTimersByTime(5 * 60_000 + 1);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));

  jest.useRealTimers();
});

it("refreshes on a back/forward cache restore", async () => {
  answerWith("development");
  render(<ResumeRefresh />);

  pageShow(true);

  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

it("ignores an ordinary page load, whose data is already fresh", async () => {
  answerWith("development");
  render(<ResumeRefresh />);

  pageShow(false);

  await new Promise(resolve => setTimeout(resolve, 20));
  expect(refresh).not.toHaveBeenCalled();
});
