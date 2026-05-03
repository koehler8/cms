# Changelog

## 1.0.0-beta.9

### `Home.vue`: suppress the loading placeholder during initial hydration

For SSG-rendered pages, `componentKeys` briefly resets to `[]` on the client during the first `syncPage` call before the cached config resolves. That made `showLoadingIndicator` flicker true for one tick, causing a jarring "Loading…" flash on top of already-rendered content. The placeholder now waits for the first `onMounted` + `nextTick` before it can render — initial hydration is silent, but genuine in-session navigation that's actually slow can still surface the placeholder.

### Pin Node 20.19 / npm 10.8 via `engines` + `.nvmrc`

Adds `engines.node: ">=20.19.0"` and `engines.npm: "^10.8.0"` to `package.json`, plus a top-level `.nvmrc`. Matches AWS Amplify's default Node 20 environment, eliminating the lockfile drift that bit the coastalcollective site deploy when a regen on npm 11 stripped the `@rolldown/binding-linux-x64-gnu` optional-dep entries Amplify needed. Sites consuming the framework should add a matching `.nvmrc` and switch back to `npm ci` for reproducible installs.

## 1.0.0-beta.8

### Theme system: SSR-rendered theme attribute + sync-bundled theme CSS

Eliminates the flash-of-unstyled-content that affected every dark-themed site.

- **`applySiteTheme` now pushes `htmlAttrs.data-site-theme` via @unhead** in addition to setting it on `document.documentElement`. The attribute lands in the SSR-rendered HTML, so theme CSS selectors (`:root[data-site-theme="X"]`) apply during the first paint instead of after Vue hydrates.
- **External themes can now ship CSS via side-effect import** (`import './theme.css';` in `index.js`) instead of `?inline` + JS injection. Vite bundles the CSS as a regular asset and emits a `<link rel="stylesheet">`, so it's parsed before Vue runs. The legacy `?inline` pattern still works — existing `@koehler8/cms-theme-*` packages don't need to be updated.

Sites previously using critical-path CSS overrides (`html { background: ... !important }`) to mask the FOUC can now rely on the active theme to drive body background, header chrome, etc. from the very first paint.

## 1.0.0-beta.1

Initial public beta release.

### Features

- Vertex CMS — lightweight, config-driven Vue 3 framework with Vite plugin
- Theming system with design token manifests and CSS custom properties
- Extension system with AJV-validated manifests and component loader
- Built-in components: Header, Hero, Footer, Contact, and more
- Dynamic routing from page config with locale support
- SSG support via ViteSSG
- Analytics and cookie consent utilities
- CLI tools for theme/extension validation and asset generation
- Vitest test suite with coverage
- GitHub Actions publish workflow
