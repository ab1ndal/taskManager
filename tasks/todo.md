# iOS standalone: always-current tasks + native feel

Branch `feat/ios-standalone`. Started 2026-09-05. Two users, iPhone 16 Pro (402px) and
iPhone 14 Pro (393px). Narrow-screen floor is 393px; 320/375-only defects are out of scope.

## Decisions taken in discussion

- Freshness is a **resume-refresh** problem, not a push problem. iOS suspends standalone apps;
  push needs permission, can be denied, and fires once a day. Push is an accelerator only.
- New build detected -> **silent reload, guarded** (no dialog open, no dirty input).
- App badge counts **overdue + due today**, clears when the task list loads.
- Declarative Web Push (iOS 18.4+) with the existing SW handler kept as override/fallback.

## Ruled out, with reasons

- Background Sync / Periodic Background Sync: never shipped on iOS. Dead code on both phones.
- Prefetching task data in the SW push handler: WebKit revokes the subscription for
  userVisibleOnly violations, and the SW has no Supabase session. Payoff is seconds.
- SW-driven update detection: `sw.js` bytes never change across deploys, so `controllerchange`
  would never fire. The SW has no fetch handler and is not the staleness source.
- Vercel Skew Protection: project is on the **Hobby** plan; Pro/Enterprise only.
- `deploymentId` in next.config.ts and the `__vdpl` cookie: wrong for a Vercel-built project.
- `/sw.js` cache headers: already `public, max-age=0, must-revalidate` on the live deployment.

## Steps

- [ ] 1. Manifest reachable: exempt `/manifest.webmanifest` in `src/proxy.ts`. It 307s to /login
      today because manifests are fetched with credentials omitted, so `display: standalone`,
      `start_url: /tasks`, name and icons have never applied.
- [ ] 2. Build id endpoint `src/app/api/build-id/route.ts` returning the commit SHA.
- [ ] 3. `<ResumeRefresh />` in the root layout: visibilitychange + pageshow, timestamp-guarded,
      `router.refresh()` for data and a no-store build-id compare for code.
- [ ] 4. Server Action failure path for a stale client (no skew protection on Hobby).
- [ ] 5. Push badge: `app_badge` in the declarative payload from delivery.ts, `setAppBadge` in
      sw.js for pre-18.4, clear on task list load, re-upsert subscription on open.
- [ ] 6. Layout fixes at 393px: nav wrap, toaster bottom inset, /login safe-top, /tasks bottom
      inset, ~14 touch targets under 44px, four break-words, board skeleton shift.
- [ ] 7. Tests: Playwright project at 402px, touch-target scan with dialogs open, unit tests for
      the resume-refresh guards.
- [ ] 8. Verify: typecheck, lint, jest, e2e.

## Blocked / needs the user

- **VAPID keys are not set in production.** No `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` or `VAPID_SUBJECT`. Step 5 can be written but not verified end to end.
- Real-device pass: dialog bottom edge vs home indicator, keyboard in the edit modal, board drag
  at phone width, workspaces header wrap.
- Unverified anywhere in the docs: whether an app-switcher resume fires `pageshow{persisted:true}`
  on current iOS. Design listens to both events because of this. Confirm on device.
