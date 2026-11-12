---
bump: patch
section: Security
---
- **cms now develops and tests against `vite` 8.3.8, outside GHSA-587h-7wmj-h5pm.**
  `vite` 8.3.0–8.3.2 ship a `launch-editor` whose `fs.existsSync()` existence
  check can be bypassed on Windows. The `vite` peer range stays `^8.3.0`, so
  updating cms does not move a site's own `vite`: a site is clear of the
  advisory only once its own lockfile resolves `vite` 8.3.3 or later, through the
  site's own dependency bump. No code in cms imports `vite`.
