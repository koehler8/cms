# @koehler8/cms

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Packages](https://img.shields.io/badge/npm-GitHub%20Packages-brightgreen)](https://github.com/koehler8/cms/packages)

Config-driven Vue 3 CMS framework with theming, extensions, and SSG support.

## Quick Start

### 1. Create a site repo

```
my-site/
  site/
    config/
      site.json        # Site metadata and settings
      shared.json      # Shared content blocks
      pages/
        home.json      # Per-page content
    assets/            # Images and media
    style.css          # Site-specific overrides (optional)
  .env
  package.json
  vite.config.js
```

### 2. Install

Configure npm to use GitHub Packages for the `@koehler8` scope:

```
@koehler8:registry=https://npm.pkg.github.com
```

Then install:

```bash
npm install @koehler8/cms vue vue-router vite vite-ssg @vitejs/plugin-vue
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
npm run dev       # Development server
npm run build     # Production build
vite-ssg build    # Static site generation
```

## Plugin Options

| Option | Default | Description |
|--------|---------|-------------|
| `siteDir` | `'./site'` | Path to site content directory |
| `frameworkRoot` | (auto) | Path to `@koehler8/cms` package root |
| `locales` | all 15 supported | Array of locale codes to enable |
| `themes` | `[]` | Theme package names to register |
| `extensions` | `[]` | Extension package names to register |

## Site Configuration

Site content lives in `site/config/`:

- **`site.json`** -- Site-level metadata (title, description, URL, theme, Google Analytics ID)
- **`shared.json`** -- Content blocks shared across pages (header, footer, socials)
- **`pages/*.json`** -- Per-page content keyed by page ID

### Locale Overrides

Place locale-specific configs in `site/config/i18n/{locale}/` mirroring the same structure. They are deep-merged over the base config at runtime.

**Supported locales:** en, fr, es, de, ja, ko, pt, ru, tr, vi, id, zh, th, hi, fil

## Themes

Themes export a manifest with design tokens (palette, typography, surfaces, CTAs, etc.) that are applied as CSS variables at runtime.

- Set `site.theme` in `site.json` to a theme slug
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

Validate extension manifests with:

```bash
npx cms-validate-extensions --site-dir ./site
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
# Generate favicon.ico, logo.png, og-image.jpg from source assets
npx cms-generate-public-assets --site-dir ./site

# Validate theme manifests
npx cms-validate-themes

# Validate extension manifests
npx cms-validate-extensions --site-dir ./site
```

## Exports

```js
import cmsPlugin from '@koehler8/cms/vite';           // Vite plugin
import { createCmsApp } from '@koehler8/cms/app';      // App factory
import { loadConfigData } from '@koehler8/cms/utils/loadConfig';
import { resolveAsset, resolveMedia } from '@koehler8/cms/utils/assetResolver';
import { useResponsiveImage } from '@koehler8/cms/utils/imageSources';
// ... and all other utils/*, composables/*, components/*, etc.
```

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `VITE_SHOW_COOKIE_BANNER` | cookieConsent | Enable cookie consent banner |
| `CMS_SITE_DIR` | generate-public-assets | Site directory path (build scripts) |
| `FAVICON_BG` / `FAVICON_FG` | generate-public-assets | Favicon background/foreground colors |

## License

MIT
