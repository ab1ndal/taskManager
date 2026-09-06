# The iPhone app

Hearth ships to two iPhones as an installed web app, added to the Home Screen from Safari's share
sheet. There is no native wrapper and no Apple Developer membership. For notification behaviour see
[Daily reminders](reminders.md); for keys and deployment steps see [reminder setup](reminders-setup.md).

| Concern | File |
| --- | --- |
| Manifest | `src/app/manifest.ts` |
| Standalone metadata, safe areas | `src/app/layout.tsx` |
| Refresh on resume, deploy detection | `src/components/resume-refresh.tsx` |
| Running build identifier | `src/lib/build-id.ts`, `src/app/api/build-id/route.ts` |
| Badge clearing, subscription upkeep | `src/components/push-upkeep.tsx` |
| Push handling | `public/sw.js` |

## What makes it launch standalone

Two independent things, and both must exist. `appleWebApp: { capable: true }` in the root layout is
what iOS reads; without it the icon opens a Safari tab and the manifest's display mode is ignored.
The manifest supplies `display: standalone`, `start_url: /tasks`, the name and the icon list for
everything else, and iOS takes the Home Screen glyph from `apple-icon.png` rather than from the
manifest's icons.

The manifest must be reachable without a session. Browsers fetch it with credentials omitted, so the
Supabase cookie is never sent: behind auth it redirects to the login page on every install and the
install silently falls back to defaults. `src/proxy.ts` exempts it alongside `/sw.js`.

`viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to real numbers. Without it they
are all zero. The insets are then applied deliberately: `.safe-top` on the nav and on `/login`, which
renders no nav and would otherwise sit under the status bar, and `env(safe-area-inset-bottom)` on
`body`, on the toaster — a fixed element is positioned against the viewport, so `body`'s padding
never reaches it — and inside the `min-h` calculations on `/login` and `/tasks`, which otherwise
overshoot by the height of the home indicator.

## Staying current

iOS suspends a standalone web app rather than killing it. A Home Screen launch usually restores a
JavaScript context that has been parked for hours: its task list is whatever the last fetch returned,
and its code is whatever was deployed when it first loaded. Neither corrects itself without a
navigation, and the app is a single screen the user rarely navigates away from.

`ResumeRefresh` handles both when the document becomes visible and on a persisted `pageshow`
(a back/forward-cache restore), throttled to one check per ten seconds. Ordinary page loads are
ignored because their data is already fresh. A five-minute interval also checks while the app stays
visible, narrowing the stale-client window when a deployment lands during use.
`router.refresh()` covers the data. For code it fetches `/api/build-id` with `cache:
'no-store'` and compares the answer against the `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` baked into the
bundle at build time; a difference means a deploy happened underneath us, and it reloads — but only
when no dialog is open and no text field has focus, so a reload never eats what someone is typing.
There is always another resume.

A stale client is not merely out of date. Server Actions encrypt their arguments with a build-derived
key, so an old client calling one against a newer deployment fails outright. Vercel's Skew Protection
would normally absorb that, but it requires a Pro or Enterprise plan and this project is on Hobby.

The service worker cannot be the update signal, which is worth stating because it is the obvious
design and it does not work here: `sw.js` is byte-identical across app deploys, so `controllerchange`
never fires. It also ships no `fetch` handler and caches nothing, so it is not the source of
staleness either — `/_next/static` is content-hashed and immutable, and Vercel already serves
`/sw.js` as `public, max-age=0, must-revalidate`.

Both `visibilitychange` and `pageshow` are observed because which one a Home Screen resume fires on
current iOS is not documented either way. The widely repeated claim that iOS reloads standalone web
apps on every foreground dates from before iOS 13 and should not be relied on.

## Not available on iOS

Background Sync and Periodic Background Sync have never shipped in Safari, so there is no way to
refresh data while the app is closed. Freshness is a resume-time concern by necessity.

The push handler deliberately does not prefetch task data. WebKit revokes a push subscription when
the `userVisibleOnly` promise is broken, the service worker has no Supabase session, and the payoff
would be a few seconds of freshness at the cost of losing push entirely.

## Screen sizes

The two target phones are 393px (iPhone 14 Pro) and 402px (iPhone 16 Pro) wide, and both are
Playwright projects. Anything narrower is out of scope: the 320–375px defects that an audit found —
the task title squeeze, the edit-modal subtask row, colour-picker anchoring, board scroll affordance
— were left alone deliberately rather than fixed speculatively.

Two rules are enforced by `e2e/layout.spec.ts` rather than by review. No page may scroll
horizontally. Every control must be at least 44px tall, scanned on the task list, inside an open
dialog and on the workspaces screen — a checkbox is exempt when its label provides the target,
because tapping the label is what toggles it. WebKit does not apply `min-height` to a menulist
`<select>`, so selects carry an explicit `h-11`.

Inputs are 16px under `pointer: coarse` (`globals.css`) because Safari zooms the page when a focused
field is smaller, and the zoom does not undo itself.

## Verified on device, not in CI

Four things need a real standalone launch and are not covered by any test: whether a dialog's bottom
edge clears the home indicator, how the edit modal behaves with the software keyboard up (`dvh` does
not shrink for the keyboard on iOS), whether board drag-and-drop is usable at phone width, and
whether an app-switcher resume fires `pageshow` with `persisted: true`.
