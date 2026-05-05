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
- **Draft mode**: `site.draft`, `site.draftPaths[]`, page `draft` flags mark content as not-yet-public. Single source of truth is `src/utils/draftMode.js` (`isPathDraft`); used by `usePageMeta` (noindex meta), `useDraftGate` + `DraftGate.vue` (renders in place of `<main>` so SSG HTML on disk contains only the gate), and `vite-plugin.js` (generates `robots.txt` and `sitemap.xml` dynamically per build). `site.draftPassword` is one site-wide password persisted via `sessionStorage`. Empty password is a deliberate fail-safe state — gate still appears but accepts empty.
- **Canonical URLs**: each page renders at exactly one URL — base locale at `/path`, non-base locales (only those with content on disk) at `/{locale}/path`. `src/utils/canonicalUrl.js` is the single URL-formula source; consumed by `usePageMeta` (emits `<link rel="canonical">` and `<link rel="alternate" hreflang="...">` in `<head>`) and `sitemapGenerator` (emits `<xhtml:link>` alternates for multi-locale). The router's `/:locale/...` regex is built from `availableLocales` minus `baseLocale`, so `/en/about` (when `en` is base) doesn't match the locale layout and falls into the SPA catch-all.
- **Per-page meta**: `usePageMeta` is the single source for `<title>`, `<meta name="description">`, `<meta property="og:*">`, `<meta name="twitter:*">`, `<link rel="canonical">`, and `<link rel="alternate" hreflang>` — all emitted via `useHead`. `src/utils/socialMeta.js` builds the OG/Twitter array; pages override via `meta.image` / `meta.ogType` / `meta.twitterCard`. `templates/index.html` only has site-wide invariants (favicon, JSON-LD Organization).
- **404 page**: `usePageConfig.selectPage` returns a `__not_found__` sentinel with `isNotFound: true` and `components: [{ name: 'NotFound' }]` for any non-root path that doesn't match a page; sites can author `pages/404.json` to customize chrome/copy. The plugin pre-renders `/404` and copies `dist/404/index.html` → `dist/404.html` after the SSG render pass (`ssgOptions.onFinished`) so AWS Amplify serves it for unmatched URLs with HTTP 404. `usePageMeta` skips canonical/hreflang/OG and emits `noindex` on 404s.
- **JSON-LD structured data**: pages and `site.json` accept a top-level `jsonld` key (object or array of objects). `src/utils/jsonLd.js` normalizes both into `<script type="application/ld+json">` blocks; site blocks emit before page blocks. `@context` is defaulted to `https://schema.org` when authors omit it. Drafts and 404s skip JSON-LD entirely.
- **Web App Manifest**: `vite-plugin.js`'s `writeSeoFiles` generates `siteRoot/public/manifest.json` from `site.title` / `site.description` / `site.manifest.{themeColor, backgroundColor, startUrl, display, icons}`. `templates/index.html` references it via `<link rel="manifest">` plus `<meta name="theme-color">`. `src/utils/webAppManifest.js` is the pure builder.
- **Site verification meta**: `site.siteVerification.{google, bing, pinterest, facebook, yandex}` in `site.json` emits the matching `<meta name="..." content="...">` (e.g. `google-site-verification`, `msvalidate.01`, etc.) on every page via `usePageMeta`.
- **Image variants**: `scripts/generate-image-variants.js` (powered by `sharp`) reads `site/assets/img/_source/**` at build time and writes `{name}-{width}.{format}` variants into `site/assets/img/`. Default matrix: 6 widths × 3 formats (avif, webp, jpg). Configurable via `site.imageVariants.{widths, formats, quality}` in `site.json`. Bundled components consume the variants via `useResponsiveImage` (`src/utils/imageSources.js`) which builds the `<picture>` `srcset` from on-disk filenames.
- **Auto-breadcrumbs**: `src/utils/breadcrumbs.js` derives a `BreadcrumbList` JSON-LD from the current path. `usePageMeta` appends it AFTER any author-supplied `jsonld` blocks. Skipped on home/draft/404/missing `site.url`, opt-out via per-page `meta.breadcrumbs: false`. Label resolution: matching page's `meta.title` first, slug-formatted segment fallback.

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
| Draft mode behavior | `src/utils/draftMode.js`, `src/composables/useDraftGate.js`, `src/components/DraftGate.vue`, `src/utils/sitemapGenerator.js`, `src/utils/robotsGenerator.js`, `vite-plugin.js` (writeSeoFiles) |
| Canonical / hreflang | `src/utils/canonicalUrl.js` (formula), `src/composables/usePageMeta.js` (head emission), `src/utils/sitemapGenerator.js` (xhtml:link alternates), `src/router/index.js` (`buildRoutes` + `availableLocales` minus base), `vite-plugin.js` (on-disk locale discovery, virtual config exports) |
| OG / Twitter / per-page meta | `src/utils/socialMeta.js` (buildSocialMeta), `src/composables/usePageMeta.js` (useHead emission), `templates/index.html` (site-wide JSON-LD only) |
| 404 page / not-found behavior | `src/components/NotFound.vue` (bundled fallback), `src/composables/usePageConfig.js` (selectPage returns sentinel), `src/composables/usePageMeta.js` (isNotFound title/noindex), `vite-plugin.js` (pre-renders /404, copies to 404.html via ssgOptions.onFinished) |
| JSON-LD / Web App Manifest / site verification | `src/utils/jsonLd.js` (page+site block normalization), `src/utils/webAppManifest.js` (manifest builder), `src/composables/usePageMeta.js` (script[] + verify meta emission), `vite-plugin.js` (writeSeoFiles writes manifest.json), `templates/index.html` (link rel=manifest + theme-color) |
| Image variants pipeline | `scripts/generate-image-variants.js` (sharp orchestrator), `bin/cms-generate-image-variants.js` (CLI), `src/utils/imageSources.js` (`useResponsiveImage` runtime consumer) |
| Auto-breadcrumb JSON-LD | `src/utils/breadcrumbs.js` (path → BreadcrumbList), `src/composables/usePageMeta.js` (appends to script[]) |

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

## Accessibility (WCAG 2.2 Level AA — hard requirement)

**Every consumer site that ships on this framework must meet WCAG 2.2 Level AA.** Real-estate, hospitality, retail, and similar public-accommodation sites are frequent ADA-lawsuit targets in the US, and AA is the de facto benchmark courts apply. The framework itself was audited and brought to AA in `1.0.0-beta.17` ([CHANGELOG](CHANGELOG.md#100-beta17)) — the bundled components, the `base` theme, and the page wrapper all conform out of the box. Don't regress that, and don't ship a feature that re-introduces a failure pattern.

### What "AA-compliant" means in practice for this codebase

The framework guarantees these for any consuming site that uses the bundled `Home.vue` wrapper, the bundled components, and the `base` theme:

- **Skip link** to `<main id="main-content">` as the first focusable element on the page (WCAG 2.4.1 Bypass Blocks).
- **Single `<main>` landmark** + `<header>`, `<nav aria-label="…">`, `<footer>` correctly placed (1.3.1 Info and Relationships).
- **`html { scroll-padding-top: 88px }`** so anchor jumps and skip-link landings are not obscured by the sticky header (2.4.11 Focus Not Obscured).
- **Real `<label>`s, `aria-required`, `autocomplete`, `aria-live` for errors** on `Contact.vue` (3.3.2 Labels, 4.1.2 Name/Role/Value).
- **Visible `:focus-visible`** rings on every interactive element in bundled components (2.4.7 Focus Visible).
- **`prefers-reduced-motion`** honored across all animated bundled components (2.3.3 Animation from Interactions).
- **Modal focus trap + restore** in `IntroGate` and `ComingSoonModal` (2.4.3 Focus Order).
- **`<noscript>` fallback** for scroll-reveal targets so SSG content is visible without JS (1.4.4 in spirit).
- **`base` theme palette** verified: every text-on-bg pair the components render meets 4.5:1 (text) or 3:1 (large text and non-text UI). New top-level token blocks `tokens.hero` / `tokens.footer` / `tokens.plan` exist specifically to pair text with non-default backgrounds and prevent the "fallback chain reaches a token designed for a different surface" trap.

### When you change something, check it

When touching any of these, re-verify accessibility before merging:

| Change | What to check |
|---|---|
| **Theme palette** (any `themes/*/theme.config.js`) | Compute contrast for every text/UI pair the components render. 4.5:1 for body text, 3:1 for large text (≥18pt or 14pt bold) and non-text UI. The audit script pattern is in [CHANGELOG.md `1.0.0-beta.17`](CHANGELOG.md#100-beta17). |
| **A bundled component's markup** | Heading order (one `<h1>` per page, no skips), landmarks, focus management, target sizes (≥24×24 CSS px per 2.5.8). |
| **A bundled component's CSS** | Don't add `outline: none` without a replacement. Don't drop the `:focus-visible` rule. Don't break `prefers-reduced-motion`. |
| **`Home.vue` / `templates/index.html`** | Skip link must remain the first focusable element. `<main id="main-content" tabindex="-1">` must be the only `<main>`. `scroll-padding-top` must remain. |
| **A new built-in component** | New components must ship with: semantic HTML, `:focus-visible` styles, `prefers-reduced-motion` block if animated, ARIA only where native semantics aren't enough, AA-compliant default colors via theme tokens. |
| **`DraftGate.vue` markup or styles** | Gate is `role="dialog"` `aria-modal="true"`, focus moves to the password input on mount, error region is `aria-live="polite"`. When making changes: keep the real `<label>` (no placeholder-as-label), keep `:focus-visible` rings on input + submit, keep the `prefers-reduced-motion` block. The gate must render inline (not teleported) so SSG HTML on disk contains only the gate when locked. |

### Token naming conventions for accessibility

When adding new theme tokens that will be rendered as text, follow the existing pattern:

- **Decorative palette colors** (used as fills, backgrounds, icons) can be brighter — name them `accent`, `accentDecorative`, `success`, `warning`, `critical`, etc.
- **Text-safe variants** of those colors get a `Text` suffix — `successText`, `warningText`, `criticalText`. These must compute ≥4.5:1 against the surface they will appear on.
- **Surface-pairing token blocks** (e.g. `tokens.hero`, `tokens.footer`, `tokens.plan`) exist for surfaces with non-default backgrounds. Components that render on those surfaces must read from the matching `--brand-{surface}-*` CSS variables, not fall through to `--ui-text-primary` (which assumes the default light body bg).

### What to do if a fix is non-trivial

If preserving AA conformance for a feature requires a structural change you're not sure about — **stop and ask before merging**. AA is a hard requirement for shipped sites; getting it wrong creates legal exposure for the site owner. A short conversation up-front beats a regression that ships and gets caught months later in an audit.

## URL hygiene

The framework emits canonical URLs without a trailing slash (`/about`, not `/about/`). `vite-ssg`'s `dirStyle: 'nested'` writes `dist/about/index.html`, which AWS Amplify (and most static hosts) serve for both `/about` and `/about/` — same file, two URLs. To pick one and 301 the other, consumer sites should add an Amplify customRule:

```
Source: /<*>/    Target: /<*>    Status: 301
```

Add it in the Amplify console under "Rewrites and redirects" (or in the site's `amplify.yml` `customRules` if preferred). The framework already emits a `<link rel="canonical">` per page, so search engines pick the canonical regardless of which URL they crawl — the 301 is belt-and-suspenders for analytics cleanliness and inbound-link consolidation.

Locale URLs follow the same single-URL rule:
- Base locale at unprefixed `/path`.
- Non-base locales (with content on disk) at `/{locale}/path`.
- `/{baseLocale}/path` does NOT route, does NOT pre-render, does NOT appear in sitemap.

`/{baseLocale}/path` URLs (e.g. `/en/about` on a US site) no longer pre-render or match the locale layout. The bundled `Header` builds dropdown links correctly (`baseLocale → /`, others → `/{locale}`) and `applyRouterGuards` redirects in-SPA navigation that still tries `/{baseLocale}/...` to the canonical unprefixed path. **Direct external hits aren't covered by either** — those serve the SSG-generated `404.html`. Sites with inbound external links to legacy `/{baseLocale}/...` URLs should add an Amplify customRule:

```
Source: /<baseLocale>/<*>    Target: /<*>    Status: 301
```

For example, on an English-base site: `Source: /en/<*>  Target: /<*>  Status: 301`. Add it in the Amplify console under "Rewrites and redirects" (placed before any catch-all SPA fallback rule).

## Gotchas

- **lru-cache TLA patch**: `scripts/patch-lru-cache-tla.js` runs on postinstall to strip top-level await from lru-cache for Node 20 compatibility. Don't remove it until upstream fixes.
- **No pre-bundling for vue/vue-router/pinia**: These are excluded from Vite's optimizer to prevent duplicate module instances when extensions are linked.
- **cookieConsent analytics default**: `shouldEnableAnalytics()` returns true when consent is pending (analytics load before explicit consent). See the GDPR note in that file.
- **canvas dependency**: Required for `generate-public-assets` (PNG/ICO generation). Needs system libs (cairo, pango, etc.) — see CI workflow for apt packages.
