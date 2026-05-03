# Changelog

## 1.0.0-beta.16

### `cms-create-site` CLI

Third bin in the scaffolding family (alongside `cms-create-theme` and `cms-create-extension`). Bootstraps a complete new site repo from one command:

```bash
npx cms-create-site cityofangels
# → site-cityofangels/{package.json, vite.config.js, amplify.yml, .nvmrc,
#   .gitignore, .env.example, README.md, CLAUDE.md, site/content/...}
```

The scaffolded repo includes a substantial **`CLAUDE.md` template** with a "where things go" navigation table covering content / components / themes / extensions / locales / pages — so future Claude sessions opening the repo immediately have the right mental model. The same template includes the lockfile/npm-version rules (matching what sister sites already document) and pointers at the other two scaffolding CLIs.

The site template ships with a working home page (`Header` + `Hero` + `Footer`) using bundled CMS components and placeholder copy — `npm run dev` produces a live page from the moment scaffolding finishes, so the site owner can see the foundation before customizing.

### Scaffold internals

- `runScaffold` now accepts `kind: 'site'` alongside `theme` and `extension`. Default target dir is `<cwd>/site-<slug>/` (matches the conventional `koehler8/site-<slug>` repo naming) instead of `themes/<slug>` or `extensions/<slug>`.
- `collectTemplateFiles` no longer skips dotfiles wholesale. Site templates legitimately include `.nvmrc`, `.gitignore`, `.env.example`. Only OS junk (`.DS_Store`, `Thumbs.db`, `.git`) is now skipped.

5 new specs in `tests/scripts/scaffold.spec.js` cover the site scaffold (336/336 passing).

## 1.0.0-beta.15

### Remove built-in `Loading…` placeholder; expose loading state via inject

The `Home.vue` page wrapper no longer renders an inline `<div class="page-loading-placeholder">Loading…</div>` (or its sibling `page-error-message`) at all. The element was a generic default that consumer sites either had to live with, restyle, or hide via critical CSS. The hydration-tick guard added in beta.9 had already prevented the flash on SSG-rendered pages, but the markup is now removed at the source — sites no longer need to know it ever existed.

In its place, `Home` now provides two refs via `provide()` so sites can build their own loading / error UI as a normal component:

- `inject('pageIsLoading')` — `Ref<boolean>` reflecting whether `usePageConfig`'s `syncPage()` is in flight.
- `inject('pageLoadError')` — `Ref<Error|null>` set when a page-load promise rejects.

**To add a preloader / error UI to a site:**

- Drop a `site/components/Preloader.vue` (or `ErrorBanner.vue`, etc.) that injects the refs and renders conditionally on their value, then list the component in any page's `components[]` array. Auto-globbed since beta.10.
- Or use the bundled `Preloader` component (currently a four-dot placeholder shell — sites typically override it via `site/components/Preloader.vue`).

**Migration**: sites that were carrying a `.page-loading-placeholder { display: none !important }` rule in their critical CSS to suppress the flash can drop it. The element no longer exists in the DOM.

## 1.0.0-beta.14

### Scaffolding CLIs: `cms-create-theme` and `cms-create-extension`

Two new bin scripts that scaffold a starter theme or extension into the current site, replacing the multi-file copy/paste dance with a single command.

```bash
npx cms-create-theme coastal
# → themes/coastal/{package.json, index.js, theme.config.js, theme.css, README.md}
# → prints next-step instructions for wiring into package.json + vite.config.js

npx cms-create-extension realestate
# → extensions/realestate/{package.json, extension.config.json, index.js, README.md}
# → ships with components: [] (no stub needed, since 1.0.0-beta.11)
```

Flags:
- `--out <dir>` — override the default target (`themes/<slug>/` or `extensions/<slug>/`).
- `--force` — overwrite an existing target directory.
- `--help` / `-h` — show usage.

The generated theme manifest validates against `themeValidator` immediately (a slate-and-sand placeholder palette — meant to be replaced). The generated extension manifest declares `components: []` and the README explains how to add components plus when to prefer `site/components/` instead.

The CLI **does not** modify your site's `package.json` or `vite.config.js` — wiring is left to a copy/paste from the printed next-steps message, since automatic edits risk corrupting custom formatting and are harder to reverse than three lines of JSON.

## 1.0.0-beta.13

### `Header` slots + content-driven logo / nav

The bundled `Header` component now exposes three named slots and three optional content keys, so sites can customise it without forking the component or carrying CSS hacks.

**Slots** (for sites that wrap `Header` in a parent component):

- `<template #logo>` — completely overrides the logo `<a>` contents. Receives `{ src, text, siteName }` as scoped slot props.
- `<template #nav>` — overrides the nav `<ul>` rendering. Receives `{ items }` as a scoped slot prop.
- `<template #actions>` — extra content rendered inside the actions cluster, before the locale dropdown.

**Content keys** (for sites that use the bundled `Header` via JSON `components: ["Header"]`):

- `content.header.logoText` — text shown in place of the site title in the logo position.
- `content.header.logoSrc` — full URL to use as the logo image (overrides the `site/assets/img/logo.png` asset resolution).
- `content.header.navItems[]` — array of `{ text, href, target? }` rendered as a top-level nav menu (responsive: hidden < 720px).

**Behaviour change**: when neither `logoSrc` nor a `site/assets/img/logo.png` resolves, the Header now renders a text fallback (`logoText` or `siteName`) instead of an empty `<img src="">`. Sites that were carrying a critical-CSS workaround to hide the empty `<img>` (e.g. `.site-header__logo img { display: none } / ::after { content: '...' }`) can drop it.

## 1.0.0-beta.12

### Drop the implicit `base` theme auto-apply (BREAKING for sites that relied on it)

Previously, when a site didn't configure a theme (`theme:` key absent from `site.json`), `applySiteTheme` silently fell back to `"base"`, applying the bundled blue/orange palette. That hid configuration mistakes — a site could register a theme in its `vite.config.js` `themes:` array, forget to add `"theme": "X"` to `site.json`, and silently render with `base` instead of the theme it intended.

`applySiteTheme` now returns early when no theme is configured. The `data-site-theme` attribute is not set on `<html>`, none of the `:root[data-site-theme="X"]` rules in `virtual:cms-theme-vars.css` apply, and components fall back to their hardcoded CSS defaults (which look mixed and a bit broken — that's intentional, it makes the misconfiguration visible).

**Migration**: sites that *want* the bundled `base` palette as their design must add `"theme": "base"` to `site.json`. Sites that intend a different theme must register it in `vite.config.js` `themes:` AND set `"theme": "<slug>"` in `site.json`.

`setActiveThemeKey` (used by JS color utilities like `resolveThemeColor`) is unchanged and still falls back to `base` for color resolution, so utility palette lookups continue to work even with no `data-site-theme` on `<html>`.

## 1.0.0-beta.11

### Allow setup-only / styles-only extensions

Extension manifests can now declare `components: []`. Previously the schema enforced `components.minItems: 1`, which forced extensions whose only contribution is a `setup()` function or a side-effect CSS import to ship a no-op stub Vue file just to satisfy the validator (e.g. the coastalcollective site's `ext-shell` and `cms-ext-realestate` both carried `Placeholder.vue` / `SiteShell.vue` for this reason).

The runtime loader already iterated `manifest.components` with `.some()` and `for...of`, so empty arrays work without further code changes. `registerExtension` accepts `{ manifest: { components: [] } }` and skips component registration entirely; `setup()` and `contentDefaults` continue to work as before.

## 1.0.0-beta.10

### First-class site-local components

Sites can now drop Vue files into `site/components/**/*.vue` and reference them from `pages/{pageId}.json` `components[]` by basename — no extension wrapper, no `package.json`, no `vite.config.js` change. The framework auto-globs them at build time via a new `virtual:cms-site-components` virtual module that the generated entry hands to `setSiteComponents()`.

- **Resolution priority**: site → extension → bundled. Most-specific wins.
- **Source-qualified `site:Name`** always resolves to a site-local component, mirroring the existing `slug:Name` extension qualifier. Use it to disambiguate when a site component intentionally shadows a bundled or extension one.
- **Override warnings**: when a site component shadows a bundled CMS component, a one-line dev-time console warning fires at startup naming the shadow. Duplicate basenames across subdirectories also warn (first registration wins).
- **Component contract**: site components follow the same conventions as bundled CMS components — read content via `inject('pageContent')`, use `<style scoped>`, consume theme tokens via `var(--brand-*)`. They receive no props from the resolver (extensions still receive `content` and `configKey`, since they have a manifest-declared `configKey`).

This is the recommended home for any one-off custom UI that doesn't need to be shared across sites. Reach for an extension only when components are actually destined for a published `@koehler8/cms-ext-*` package.

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
