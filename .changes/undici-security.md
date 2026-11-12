---
bump: patch
section: Security
---
- **Patched `undici` for GHSA-4w7w-5xrc-9h26 and GHSA-xjj6-f33q-929c.**
  `jsdom` (installed through the `vite-ssg` peer) accepts any `undici ^7.21.0`,
  which let sites keep a release below 7.30.1, open to cache poisoning and
  cross-user disclosure via cross-origin redirects, and to a denial of service
  on excessive content-encodings. cms now depends on `undici ^7.30.2` directly,
  so a site that updates cms gets the patched copy. No code in cms imports it.
