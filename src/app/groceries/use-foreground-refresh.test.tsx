import { render } from "@testing-library/react";
import { act } from "react";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { useForegroundRefresh } from "./use-foreground-refresh";

function Probe() {
  useForegroundRefresh(1000);
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useForegroundRefresh", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    refresh.mockClear();
    setVisibility("visible");
  });

  afterEach(() => jest.useRealTimers());

  it("refreshes on the interval while visible", () => {
    render(<Probe />);
    act(() => void jest.advanceTimersByTime(2100));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops while the page is hidden", () => {
    render(<Probe />);
    act(() => setVisibility("hidden"));
    act(() => void jest.advanceTimersByTime(5000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("resumes when the page becomes visible again", () => {
    render(<Probe />);
    act(() => setVisibility("hidden"));
    act(() => void jest.advanceTimersByTime(5000));
    act(() => setVisibility("visible"));
    act(() => void jest.advanceTimersByTime(1100));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears its timer on unmount", () => {
    const { unmount } = render(<Probe />);
    unmount();
    act(() => void jest.advanceTimersByTime(5000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
