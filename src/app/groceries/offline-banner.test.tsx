import { render, screen } from "@testing-library/react";
import { act } from "react";

import { OfflineBanner } from "./offline-banner";

function goOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("says nothing while online", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows while offline and hides when the connection returns", () => {
    render(<OfflineBanner />);

    act(() => goOnline(false));
    expect(screen.getByRole("status")).toHaveTextContent("No signal — showing your last list");

    act(() => goOnline(true));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows on first render when the page opens offline", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("No signal");
  });
});
