# CLAUDE.md — @koehler8/cms

## What This Project Is

A config-driven Vue 3 CMS framework (`@koehler8/cms`) published as an npm package to GitHub Packages. Consuming sites import the Vite plugin and provide a `site/` directory with JSON config and assets — no application code needed.

## Architecture

```
vite-plugin.js          Vite plugin — generates virtual modules, temp entry/index files
src/main.js             App entry — ViteSSG, Pinia, @unhead, theme/extension init
src/router/index.js     Dynamic routing from page config, locale-aware
src/components/         Built-in Vue components (Header, Hero, Footer, Contact, etc.)
src/composables/        Vue 3 composition API hooks (usePageConfig, useComponentResolver, etc.)
src/utils/              Core utilities (loadConfig, assetResolver, imageSources, etc.)
src/themes/             Theme loader, manager, and validator
src/extensions/         Extension loader with AJV manifest validation
themes/base/            Default theme with full design token manifest
extensions/             Extension manifest JSON schema
scripts/                Build-time scripts (asset generation, validation, i18n flattening)
bin/                    CLI entry points wrapping scripts/
templates/index.html    EJS-templated HTML shell
```

### Key Patterns

- **One site = one repo**: Each site is a standalone repo with a `site/` directory containing JSON config and assets.
- **Virtual modules**: The Vite plugin generates `virtual:cms-config-loader`, `virtual:cms-site-styles`, and `virtual:cms-asset-resolver` to wire site content into the framework at build time.
- **Singletons**: `loadConfigData`, `ensureSiteStylesLoaded`, `resolveAsset` etc. are initialized once by the generated `.cms-entry.js` to prevent duplicate instances across linked packages.
- **Three-tier component resolution**: Built-in components -> extension components -> fallback. Components are referenced by name or `source-slug:ComponentName`.
- **Config merging**: Deep merge with locale overrides (i18n/{locale}/) layered on top of base config.
- **Theme tokens -> CSS vars**: Theme manifests define design tokens; `themeManager.js` converts them to CSS custom properties on `document.documentElement`.

### Data Flow

1. Vite plugin reads `site/config/` and generates virtual modules
2. `main.js` creates ViteSSG app, loads config via `loadConfigData()`
3. Router resolves page by path, `Home.vue` renders via `usePageConfig()` + `useComponentResolver()`
4. Components receive merged `content` prop from page config + extension defaults
5. Theme tokens applied as CSS variables; extensions run setup hooks

## Commands

```bash
npm run dev                    # Not applicable — this is a library
npm test                       # Run full test suite (Vitest)
npm run test:watch             # Run tests in watch mode
npm run test:coverage          # Run tests with coverage report
npm run postinstall            # Patches lru-cache TLA for Node 20 compat
npx cms-validate-themes        # Validate theme manifests
npx cms-validate-extensions    # Validate extension manifests
```

## Testing

The project uses **Vitest** with happy-dom environment and `@vue/test-utils`. Tests live in `tests/` mirroring the `src/` structure.

```
tests/
  helpers/
    setup.js                   # Global mocks (IntersectionObserver, requestIdleCallback)
    package-json-raw.js        # Stub for ?raw import of package.json
  utils/                       # Tests for src/utils/*
  composables/                 # Tests for src/composables/*
  themes/                      # Tests for src/themes/*
  extensions/                  # Tests for src/extensions/*
  router/                      # Tests for src/router/*
  vite-plugin.spec.js          # Tests for vite-plugin.js helper functions
```

**Config:** `vitest.config.js` (standalone, does not require a site directory). Includes `@vitejs/plugin-vue` for `.vue` file support and an alias for the `?raw` package.json import.

**Writing new tests:**
- Place test files at `tests/{category}/{moduleName}.spec.js`
- Pure utility tests are straightforward — import and test directly
- Modules using `import.meta.glob` (componentRegistry, extensionLoader, themeLoader) execute glob at import time; test their factory functions (`createRegistry`) or exported getters
- Modules importing `@unhead/vue` or other framework-specific APIs should mock those via `vi.mock()`
- For analytics tests, mock `cookieConsent.js` and `trackingContext.js` before importing

## Publishing

1. Bump version in `package.json`
2. Commit and tag: `git tag v{version}`
3. Push tag: `git push origin v{version}`
4. GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to GitHub Packages

The CI uses `npm install --ignore-scripts` (skips the lru-cache patch since it's not needed on the publish machine).

## Key Files for Common Tasks

| Task | Files |
|------|-------|
| Add a built-in component | `src/components/`, `src/utils/componentRegistry.js` |
| Modify config loading | `src/utils/loadConfig.js`, `vite-plugin.js` (virtual module) |
| Change theme token structure | `src/themes/themeValidator.js`, `src/themes/themeManager.js`, `themes/base/theme.config.js` |
| Extension system changes | `src/extensions/extensionLoader.js`, `extensions/manifest.schema.json` |
| Asset resolution changes | `src/utils/assetResolver.js` (resolveAsset, resolveMedia), `src/utils/imageSources.js` (useResponsiveImage) |
| Router or locale logic | `src/router/index.js`, `src/constants/locales.js` |
| Analytics / consent | `src/utils/cookieConsent.js`, `src/utils/analytics.js` |
| Build scripts / CLI | `scripts/`, `bin/` |
| Add or modify tests | `tests/`, `vitest.config.js` |

## Gotchas

- **lru-cache TLA patch**: `scripts/patch-lru-cache-tla.js` runs on postinstall to strip top-level await from lru-cache for Node 20 compatibility. Don't remove it until upstream fixes.
- **No pre-bundling for vue/vue-router/pinia**: These are excluded from Vite's optimizer to prevent duplicate module instances when extensions are linked.
- **cookieConsent analytics default**: `shouldEnableAnalytics()` returns true when consent is pending (analytics load before explicit consent). See the GDPR note in that file.
- **canvas dependency**: Required for `generate-public-assets` (PNG/ICO generation). Needs system libs (cairo, pango, etc.) — see CI workflow for apt packages.
