---
bump: patch
section: Security
---
- **Moved the `undici` cms is built and tested against to 7.30.2, for
  GHSA-xjj6-f33q-929c.** `undici` 7.18.0 through 7.30.0 can crash with an
  unhandled error when a response has too many content-encodings, which is a
  denial of service. cms does not declare `undici`. It arrives through
  `vite-ssg` → `jsdom` (`undici ^7.21.0`), and cms's own lockfile had pinned
  7.29.1. That lockfile does not ship, so updating cms alone does not change a
  site's copy. To get the fix, a site refreshes `undici` in its own lockfile,
  for example with `npm update undici`, and confirms that `npm ls undici`
  reports 7.30.1 or later.
