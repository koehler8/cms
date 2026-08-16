# Vertex CMS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-registry.npmjs.org-brightgreen)](https://www.npmjs.com/package/@koehler8/cms)

Vertex CMS is a lightweight, config-driven Vue 3 framework with theming, extensions, and SSG support.

## Accessibility

Vertex CMS targets **[WCAG 2.2 Level AA](https://www.w3.org/WAI/WCAG22/quickref/?currentsidebar=%23col_overview&versions=2.2&levels=aaa)** as a hard requirement for the bundled components, the `base` theme, and the page wrapper. Sites that ship on this framework with the bundled pieces inherit a skip link, single `<main>` landmark, real form labels with `aria-live` errors, visible focus rings, modal focus trap+restore, AA-verified palette contrast, and `prefers-reduced-motion` support out of the box.

When extending or theming, **don't regress AA**. See the "Accessibility" section of [CLAUDE.md](CLAUDE.md#accessibility-wcag-22-level-aa--hard-requirement) for the requirements, the token naming conventions for safe colors, and the audit checklist to run when changing palette/markup/CSS.

## Quick Start

### 1. Create a site repo

```
my-site/
  site/
    content/
      content.config.json    # { "baseLocale": "en" }
      en/
        site.json            # Site metadata and settings
        shared.json          # Shared content blocks
        pages/
          home.json          # Per-page content
    assets/img/              # Images and media
    components/              # Site-local Vue components (optional)
    style.css                # Site-specific overrides (optional)
  .env
  package.json
  vite.config.js
```

Or scaffold all of it in one step:

```bash
npx --package @koehler8/cms@^1.0.0-beta cms-create-site my-site
```

### 2. Install

Vertex CMS is published to the public npm registry (`registry.npmjs.org`) — no scope configuration needed. Install a pinned prerelease range (the package hasn't reached a stable `1.0.0` yet, so the unpinned `latest` dist-tag isn't current):

```bash
npm install @koehler8/cms@^1.0.0-beta vue vue-router vite vite-ssg @vitejs/plugin-vue
```

### 3. Configure Vite

```js
// vite.config.js
import cmsPlugin from '@koehler8/cms/vite';

export default {
  plugins: [
    cmsPlugin({
      siteDir: './site',
      themes: ['@koehler8/cms-theme-neon'],
      extensions: ['@koehler8/cms-ext-compliance'],
    }),
  ],
};
```

### 4. Run

```bash
npm run dev        # Development server
npm run build      # Production build (SPA)
npx cms-ssg-build  # Static site generation — memory-bounded shards + blank-page gate
```

(`vite-ssg build` also works directly, but `cms-ssg-build` wraps it with a
bounded heap, route sharding for large sites, and a post-render check that
fails the build if any page comes out blank.)

## Plugin Options

| Option | Default | Description |
|--------|---------|-------------|
| `siteDir` | `'./site'` | Path to site content directory |
| `frameworkRoot` | (auto) | Path to `@koehler8/cms` package root |
| `locales` | all 15 supported | Array of locale codes to enable |
| `themes` | `[]` | Theme package names to register |
| `extensions` | `[]` | Extension package names to register |

## Site Configuration

Site content lives in `site/content/`, organized by locale:

```
site/content/
  content.config.json        # { "baseLocale": "en" }
  en/
    site.json                # Site metadata (flat dot-notation keys, sorted)
    shared.json              # Shared content (header, footer, socials)
    pages/
      home.json              # Per-page content
      privacy.json
  de/
    site.json                # German overrides (only translated keys)
    shared.json
    pages/
      home.json
```

All files use flat dot-notation keys in alphabetical order. The base locale (specified in `content.config.json`) is loaded first; other locale directories override only the keys they specify. Missing keys fall back to the base locale value.

**Supported locales:** en, fr, es, de, ja, ko, pt, ru, tr, vi, id, zh, th, hi, fil

### Analytics & consent

Set `"googleId"` in `site.json` to enable Google Analytics. How the
not-yet-answered consent state is treated is configurable:

```json
{ "analytics.consentMode": "opt-in" }
```

- `"opt-out"` (default) — analytics load while consent is pending and stop if
  the visitor declines. Common US posture.
- `"opt-in"` — analytics stay off until the visitor explicitly accepts.
  Use this for sites with EU/EEA audiences (GDPR / ePrivacy).

## Themes

Themes export a manifest with design tokens (palette, typography, surfaces, CTAs, etc.) that are applied as CSS variables at runtime.

- Set the `theme` key in `content/{baseLocale}/site.json` to a theme slug
- Omit it to use the built-in `base` theme
- External themes are npm packages registered via the `themes` plugin option

See `themes/base/theme.config.js` for the full token structure.

## Extensions

Extensions are npm packages that provide additional components, content defaults, and setup hooks.

Each extension has an `extension.config.json` manifest defining:

- **components** -- Vue components with metadata (name, configKey, allowedPages, requiredContent)
- **entry / setup** -- Optional initialization hooks
- **assets** -- CSS and static file references
- **dependencies** -- Required npm packages

The manifest JSON Schema ships with the package — point your editor or JSON-schema tooling at it:

```json
{ "$schema": "node_modules/@koehler8/cms/extensions/manifest.schema.json" }
```

## Built-in Components

| Component | Description |
|-----------|-------------|
| `Header` | Site header with navigation |
| `Footer` / `FooterMinimal` | Full and minimal footer variants |
| `Hero` | Hero banner section |
| `About` / `AboutValue` | About and value proposition sections |
| `Contact` | Contact form (Google Forms backend) |
| `Team` | Team member grid |
| `Portfolio` | Portfolio showcase |
| `Plan` | Pricing/plan comparison |
| `Principles` | Principles/values section |
| `Intro` / `IntroGate` | Intro modal and gate |
| `ComingSoon` / `ComingSoonModal` | Coming soon page and modal |
| `StickyCTA` | Sticky call-to-action bar |
| `BackToTop` | Scroll-to-top button |
| `Preloader` | Page loading indicator |
| `Spacer15/30/40/60` | Vertical spacing utilities |

### UI Components

- `SbCard` -- Card component
- `SkeletonPulse` -- Loading skeleton
- `UnitChip` -- Unit/badge chip

## Composables

| Composable | Description |
|------------|-------------|
| `usePageConfig` | Load and cache page configuration |
| `useComponentResolver` | Resolve and validate component definitions |
| `usePageMeta` | Apply head/meta tags via @unhead |
| `useEngagementTracking` | Scroll depth and engagement analytics |
| `useIntroGate` | Intro modal state management |
| `useComingSoonConfig` | Coming-soon page configuration |
| `useLazyImage` | Lazy image loading with IntersectionObserver |
| `usePromoBackgroundStyles` | Promo section background styling |

## Draft Mode

Pages can be gated behind a site-wide password before launch: `"draft": true`
on a page, `"draftPaths": [...]` prefixes, or `"draft": true` site-wide in
`site.json`, with the password in `"draftPassword"`. The build replaces the
plaintext password with a SHA-256 hash (plaintext never ships), gated pages
render only the password gate in the SSG HTML, are marked `noindex`, and are
omitted from `sitemap.xml`.

**Know what the gate is — and isn't.** Draft mode is a pre-launch
convenience, not access control:

- The password hash ships in the public bundle (unsalted SHA-256 — a weak or
  guessable password is trivially recoverable).
- The gated page's `content.*` keys still ship in the page's hydration JSON
  so Vue can mount after unlock — a determined reader can parse them out of
  the HTML without the password.

For genuinely confidential content (NDA material, unannounced listings),
don't put it in the page JSON until launch.

## Testing

The framework uses [Vitest](https://vitest.dev/) with happy-dom for unit testing.

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

Tests live in `tests/` mirroring the source structure (`tests/utils/`, `tests/composables/`, `tests/themes/`, etc.). See `vitest.config.js` for configuration.

## CLI Commands

```bash
# Scaffold a new site / theme / extension
npx cms-create-site my-site
npx cms-create-theme my-theme
npx cms-create-extension my-extension

# Static site generation (memory-bounded shards + blank-page gate)
npx cms-ssg-build

# Generate favicon.ico, logo.png, og-image.jpg from source assets
npx cms-generate-public-assets --site-dir ./site

# Validate theme manifests (bundled + your site-local themes/)
npx cms-validate-themes --site-dir ./site

# Validate extension manifests (site-local extensions/ + named packages)
npx cms-validate-extensions --site-dir ./site @koehler8/cms-ext-compliance
```

(The Vite plugin also runs the same extension-manifest validation on every
build and fails loudly on an invalid manifest — the CLIs are for checking
outside a build.)

## Exports

The supported public API surface — these specifiers are covered by semver:

```js
// Build integration
import cmsPlugin from '@koehler8/cms/vite';            // Vite plugin
import { createCmsApp } from '@koehler8/cms/app';      // App factory

// Utils commonly used by site components and extensions
import { loadConfigData } from '@koehler8/cms/utils/loadConfig';
import { resolveAsset, resolveMedia } from '@koehler8/cms/utils/assetResolver';
import { useResponsiveImage } from '@koehler8/cms/utils/imageSources';
import { trackEvent } from '@koehler8/cms/utils/analytics';
import { hasAcceptedConsent } from '@koehler8/cms/utils/cookieConsent';
import { formatTokenAmount } from '@koehler8/cms/utils/formatNumber';
import { resolveThemeColor } from '@koehler8/cms/utils/themeColors';

// Bundled components and composables (by file)
import Header from '@koehler8/cms/components/Header.vue';
import { useComingSoonConfig } from '@koehler8/cms/composables/useComingSoonConfig';
```

The extension manifest schema is exported at
`@koehler8/cms/extensions/manifest.schema.json`.

Other `utils/*`, `composables/*`, `components/*`, `themes/*`, and
`extensions/*` deep imports resolve too, but anything not listed above is
**internal** — it may move or change between minor versions.

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `VITE_SHOW_COOKIE_BANNER` | cookieConsent | Enable cookie consent banner |
| `VITE_APP_VERSION` | appInfo | Override the framework version string reported in the bundle |
| `CMS_SITE_DIR` | generate-public-assets | Site directory path (build scripts) |
| `FAVICON_BG` / `FAVICON_FG` | generate-public-assets | Fallback favicon/og colors (default: stable per-title pair) |

## License

MIT
