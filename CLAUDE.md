# CLAUDE.md — Vertex CMS

## What This Project Is

Vertex CMS (`@koehler8/cms`) — a lightweight, config-driven Vue 3 framework published as an npm package to GitHub Packages. Consuming sites import the Vite plugin and provide a `site/` directory with JSON config and assets — no application code needed.

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
scripts/                Build-time scripts (asset generation, validation, content migration)
bin/                    CLI entry points wrapping scripts/
templates/index.html    EJS-templated HTML shell
```

### Key Patterns

- **One site = one repo**: Each site is a standalone repo with a `site/` directory containing content, assets, and styles.
- **Virtual modules**: The Vite plugin generates `virtual:cms-config-loader`, `virtual:cms-site-styles`, `virtual:cms-asset-resolver`, `virtual:cms-theme-vars.css`, and `virtual:cms-site-components` to wire site content into the framework at build time.
- **Singletons**: `loadConfigData`, `ensureSiteStylesLoaded`, `resolveAsset`, `setSiteComponents` etc. are initialized once by the generated `.cms-entry.js` to prevent duplicate instances across linked packages.
- **Three-tier component resolution**: site-local (`site/components/`) → extension → bundled. Most-specific wins. Components are referenced by name; source-qualified syntax (`site:Name` or `slug:Name`) disambiguates.
- **Content directory**: All translatable copy lives in `site/content/` with per-locale subdirectories (`en/`, `de/`, `ja/`, etc.) that mirror each other's structure. A `content.config.json` at the root specifies the base locale. All files use flat dot-notation keys sorted alphabetically. The base locale is loaded first; selected locale overrides only where keys are specified.
- **Theme tokens -> CSS vars**: Theme manifests define design tokens; `themeManager.js` converts them to CSS custom properties on `document.documentElement`.

### Data Flow

1. Vite plugin reads `site/content/{baseLocale}/` and generates virtual modules
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

## Lockfile and npm version (this is the #1 source of consumer-site deploy failures)

The framework targets **Node 20.19 / npm 10.8** — pinned in [package.json](package.json) `engines` and [.nvmrc](.nvmrc). AWS Amplify (the typical deploy target for consumer sites) runs the same. **Local installs with a different npm version produce subtly different lockfiles** that look fine locally but break CI.

Two failure modes we've seen on consumer sites:

1. `Cannot find module '@rolldown/binding-linux-x64-gnu'` — npm 11 regen stripped optional-dep entries Amplify needs.
2. `npm ci ... Missing: @types/react@..., @noble/hashes@... from lock file` — npm 11 omitted entries npm 10 expects.

### Rules for maintainers

- **Always `nvm use` before any `npm install` or test run.** The `.nvmrc` here pins 20.19.0; your shell's npm should report `10.8.x`.
- **Don't bump dep versions in this repo without `nvm use` first.** A regen on the wrong npm propagates the bad lockfile to every consumer site that picks it up.
- **CI uses `npm install --ignore-scripts`** for publish (skips the lru-cache patch since publishing doesn't need it). The build workflow runs on `actions/setup-node` with the version from `.nvmrc`.

### Rules to surface to consumer sites

Each consuming site repo (e.g. `site-coastalcollective`, `site-bang`) should:

- Carry a top-level `.nvmrc` with the same Node version, plus a CLAUDE.md note telling future sessions to `nvm use` before installing.
- Default to `npm install --prefer-offline --no-audit --no-fund` in their `amplify.yml` (NOT `npm ci`) until lockfile discipline is well-established. `npm ci` is faster but fails hard on any drift; `npm install` updates the lockfile in place during the build, so it's resilient.
- Prefer **targeted bumps** (`npm install <pkg>@<version>`) over full regen (`rm package-lock.json && npm install`). Targeted bumps preserve the rest of the lockfile; full regen on the wrong npm version strips entries Amplify needs.

The `site-coastalcollective` CLAUDE.md has a full "Lockfile and npm version" section future Claude sessions can copy into other consumer sites.

## Gotchas

- **lru-cache TLA patch**: `scripts/patch-lru-cache-tla.js` runs on postinstall to strip top-level await from lru-cache for Node 20 compatibility. Don't remove it until upstream fixes.
- **No pre-bundling for vue/vue-router/pinia**: These are excluded from Vite's optimizer to prevent duplicate module instances when extensions are linked.
- **cookieConsent analytics default**: `shouldEnableAnalytics()` returns true when consent is pending (analytics load before explicit consent). See the GDPR note in that file.
- **canvas dependency**: Required for `generate-public-assets` (PNG/ICO generation). Needs system libs (cairo, pango, etc.) — see CI workflow for apt packages.
