# Core Base Theme
- **Slug**: `base` (fallback when `site.theme` is omitted)
- **Version**: 1.0.0
- **Author**: Chris Koehler (source: internal)
- **Assets**: `theme.config.js` only; no additional CSS beyond shared `base.css`/`layout.css`

## Install
- Leave `site.theme` empty to use this palette by default, or set `site.theme` to `"base"` explicitly in `sites/<site>/config/<site>.json`.
- Reload the dev server after changing the config so Vite rehydrates with the selected theme metadata.

## Visual Direction
- Neutral/light marketing canvas with deep-blue headers, soft indigo gradients, and subtle glass borders.
- CTA treatments lean on a cool blue gradient; secondary/ghost buttons stay minimal for operations dashboards and legal pages.
- Suited for general-purpose launches where you want the shared UI utilities to feel native without brand-heavy art.

## Token Highlights
- Balanced light surfaces (`card`, `callout`, `tabs`, `field`) tuned for dark headers/footers and sticky chrome.
- Consistent Inter/Clash typography stack baked into the manifest; no external CSS imports.
- Gradient helpers (`gradientHero`, `gradientPromo`) pair with the default hero/promo layouts without requiring per-component overrides.

## Compatibility Notes
- Ideal baseline for new sites before a bespoke palette is approved.
- Because there is no theme-specific CSS, any layout/animation customizations should live in your site’s optional `style.css` or a custom theme package.
