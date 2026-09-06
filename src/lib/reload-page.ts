/**
 * Isolated so tests can observe the reload: jsdom does not allow `window.location` to be
 * redefined, and a full page reload has no meaning inside a test environment.
 */
export function reloadPage() {
  window.location.reload();
}
