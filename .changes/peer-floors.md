---
bump: minor
section: Changed
---
- **Raised the peer-dependency minimums to the versions cms is tested
  against:** `vite ^8.3.0`, `vue ^3.5.43`, `vue-router ^5.3.1`,
  `@vitejs/plugin-vue ^6.0.8` (`vite-ssg` stays `^28.0.0`). A site locked
  below any of these sees a peer-dependency warning when it updates cms and
  should move those packages in the same update. The `cms-create-site`
  template starts new sites at these versions.
