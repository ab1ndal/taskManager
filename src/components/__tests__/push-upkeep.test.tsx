import { render, waitFor } from "@testing-library/react";
import { PushUpkeep } from "../push-upkeep";

const subscribeToPush = jest.fn();
jest.mock("@/app/settings/notification-actions", () => ({
  subscribeToPush: (input: unknown) => subscribeToPush(input),
}));

const clearAppBadge = jest.fn().mockResolvedValue(undefined);
const getSubscription = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, "clearAppBadge", { configurable: true, value: clearAppBadge });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription } }) },
  });
  (window as unknown as { PushManager: unknown }).PushManager = function () {};
});

it("clears the badge when the app opens", async () => {
  getSubscription.mockResolvedValue(null);

  render(<PushUpkeep />);

  await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
});

it("re-registers the subscription the browser currently holds", async () => {
  const json = { endpoint: "https://web.push.apple.com/live", keys: {} };
  getSubscription.mockResolvedValue({ toJSON: () => json });

  render(<PushUpkeep />);

  await waitFor(() => expect(subscribeToPush).toHaveBeenCalledWith(json));
});

it("does not register anything when the device has no subscription", async () => {
  getSubscription.mockResolvedValue(null);

  render(<PushUpkeep />);

  await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
  expect(subscribeToPush).not.toHaveBeenCalled();
});
