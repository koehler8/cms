# Changelog

## 1.0.0-beta.18

### Draft mode — `noindex` + password gate for in-progress content

A site, a URL prefix, or an individual page can be marked as "draft" so
search engines stay out and casual visitors hit a password gate instead of
the page contents. Designed for the iteration window before a site or
section goes public — not for protecting confidential data. **Static-host
caveat**: the gate is client-side; image and asset URLs in `dist/` remain
publicly fetchable regardless of whether the page that references them is
gated. If you need real privacy for assets, host them elsewhere.

**Schema additions** (all flat-key, optional, default off):

- `site.json`
  - `"draft": true` — marks the whole site as draft.
  - `"draftPaths[0]": "/hidden/"` — URL prefixes (path-segment-aware: `/blog`
    matches `/blog/2026/post` but not `/blog-archive`; case-sensitive).
  - `"draftPassword": "..."` — one shared password for all drafts on the
    site. The plugin replaces this field with a SHA-256 `draftPasswordHash`
    at bundle time; the plaintext never reaches `dist/` or
    `__INITIAL_STATE__`. Empty/missing is a deliberate fail-safe: the gate
    still appears but accepts any input including empty.
- `pages/{id}.json`
  - `"draft": true` — marks a single page as draft.
  - `"draft": false` — explicitly publishes a page even when the site or a
    matching `draftPaths` prefix says draft (page-level wins both ways).

**Behavior:**

- **Robots & SEO**: every draft page emits `<meta name="robots"
  content="noindex, nofollow">` and a generic `<title>Draft — {Site}</title>`
  (the page's real title and description are suppressed for drafts so the
  slug doesn't leak via `<title>` / `<meta description>`). The plugin
  generates `robots.txt` and `sitemap.xml` dynamically from the inflated
  config on every build — draft prefixes/pages get `Disallow:` lines and
  are skipped from the sitemap entirely. (Replaces the previous static
  `cms/public/robots.txt`.)
- **Runtime gate**: when a draft page is rendered, `<DraftGate>` replaces
  the page body (no Header, no Footer, no skip-link) so the SSG-rendered
  HTML on disk contains only the gate, not the content. Unlock persists
  in `sessionStorage` site-wide for the tab — closing the tab re-engages
  the gate.
- **Password is hashed at build time**: site.json's plaintext
  `draftPassword` is replaced with `draftPasswordHash` (SHA-256 hex) by a
  Vite `transform` hook before any JSON is imported. At runtime,
  `useDraftGate.attemptUnlock(input)` SHA-256-hashes the input and
  compares hashes. Plaintext password is in the source repo only — never
  in `dist/` or `__INITIAL_STATE__`.
- **SSR**: the SSR pre-render pass keeps `isUnlocked: false`, so
  `dist/<path>/index.html` is the gate HTML even after build. This is
  what crawlers and `curl` see.

**New files:**

- `src/utils/draftMode.js` — `isPathDraft`, `pathMatchesPrefix`,
  `normalizeDraftPath`, `getDraftPasswordHash`. The predicate is shared
  between the runtime gate, the meta-tag injection, and the plugin's
  robots.txt/sitemap.xml emitters.
- `src/utils/sha256.js` — `sha256Hex(input)` over Web Crypto. Used by both
  the build-time transform (Node 20.19's globalThis.crypto.subtle) and
  the runtime gate (browser SubtleCrypto).
- `src/utils/sitemapGenerator.js` — `buildSitemap(siteConfig)` returns the
  XML or '' when `site.url` is missing.
- `src/utils/robotsGenerator.js` — `buildRobotsTxt(siteConfig, sitemapUrl)`.
- `src/composables/useDraftGate.js` — reactive gate state.
  `attemptUnlock` is async (it hashes user input).
- `src/components/DraftGate.vue` — inline (not body-teleported) modal,
  theme-token-driven CSS, WCAG 2.2 AA: real `<label>`, `:focus-visible`,
  `aria-live` error region, `prefers-reduced-motion` honored.

**Edits:**

- `src/composables/usePageMeta.js` — emits the noindex meta when
  `isPathDraft` is true and replaces the `<title>` / `<meta description>`
  with generic stand-ins so the page slug and explicit `meta.title` /
  `meta.description` don't leak in the SSG-rendered HTML.
- `src/composables/usePageConfig.js` — `selectPage()` now propagates the
  page's `draft` flag onto `currentPage` so the gate, the meta, and any
  other consumer can read it.
- `src/components/Home.vue` — wraps the page render in
  `v-if="!isDraft || isUnlocked"` and renders `<DraftGate>` in its place
  when locked.
- `vite-plugin.js` — generates `siteRoot/public/robots.txt` and
  `siteRoot/public/sitemap.xml` after `syncPublicDir`. Sitemap is dropped
  when `site.url` is missing or every page is draft. Adds a `transform`
  hook that hashes `site.json`'s plaintext `draftPassword` (replacing it
  with `draftPasswordHash`) before the JSON is bundled.
- `cms/public/robots.txt` — **removed** (the plugin owns it now).

**What this protects against:**

- ✓ Search engines indexing draft content (noindex meta, sitemap exclusion,
  robots.txt Disallow, generic `<title>`).
- ✓ Casual visitors who type a draft URL — they see only the gate.
- ✓ `view-source` revealing the plaintext password — the plugin replaces
  it with a SHA-256 hash before bundling.
- ✓ `view-source` revealing the page slug or explicit `meta.title` /
  `meta.description` via the rendered `<title>` / meta tags.

**What it does NOT protect against — known v1 bounds:**

- **`view-source` of any page reveals draft pages' `meta` and `content`
  via `__INITIAL_STATE__`.** Pinia + ViteSSG serialize the full inflated
  `siteConfig` (every page's content, meta, components) into every rendered
  HTML file for hydration. So `view-source /about` shows you the full meta
  and content of every draft page on the site. Stripping draft pages'
  content from the bundle would require lazy-loading them after unlock —
  a major architecture change. For "iterate before launch / not ultra
  secure," current bound is appropriate; for confidential content, it isn't.
- **`robots.txt` lists every draft path.** This is intentional (search
  engines need to know what NOT to crawl) but does mean the URL list is
  publicly readable. Don't put secret paths in `draftPaths`.
- **Asset URLs aren't gated.** `dist/img/foo.jpg` is reachable to anyone
  who knows the URL even if the page that references it is draft.
- **Hash brute-force.** Weak passwords (e.g. `letmein`) fall to a rainbow
  table in seconds. The hash blocks "view source → password" but not a
  determined attacker. Use a long random password if it matters.
- **noindex doesn't un-index.** If a page was previously indexed, adding
  noindex tells Google to drop it on the next crawl, which can be days or
  weeks. Use Search Console URL removal if you need it gone now.
- **Public-page links to draft URLs leak the URL.** v1 doesn't rewrite
  links; if a public page `<a>`s into a draft path, the URL appears in
  the published HTML.
- **Locale interaction.** `site.draft: true` in the base locale propagates
  to all locales. To publish only one locale, set `"draft": false` in the
  per-locale `site.json`.

Tests: 414 passing (24 new for `draftMode`, 13 for `sitemapGenerator`,
13 for `robotsGenerator`, 9 added to `usePageMeta`, 17 for `useDraftGate`).

## 1.0.0-beta.17

### WCAG 2.2 AA pass on the bundled components and base theme

Audited the framework against WCAG 2.2 Level AA and applied the fixes that block conformance. Sites using `theme: "base"` and the bundled components inherit the improvements; sites with their own theme keep their palette but pick up the structural fixes (skip link, form labels, focus management, target sizes, semantic landmarks).

**Base theme palette** (`themes/base/theme.config.js`)

Re-balanced every text-on-bg combination the bundled components actually render. The previous values for `palette.primary` (`#4f6cf0`), `palette.accent` (`#f18f3b`), `field.inputPlaceholder` (composited 64% alpha), and the status colors all failed AA at 4.5:1 by varying margins.

- `palette.primary` `#4f6cf0` → `#4361dd` (4.43 → 4.91 on white).
- `palette.accent` `#f18f3b` → `#b45a00` (2.40 → 4.51 on white). The original orange is preserved as `palette.accentDecorative` for fills/icons only.
- `field.inputPlaceholder` `rgba(84, 98, 123, 0.64)` → solid `#54627b` (2.82 → 5.66 on white). Same change in `utility.inputPlaceholder` and the `.ui-form-control::placeholder` fallback in `base.css`.
- Status `palette.{success,warning,critical}` retained as fill colors; new sibling tokens `successText` / `warningText` / `criticalText` (5.99 / 5.13 / 5.43 on white) for status messaging where the value is rendered as text.
- Primary CTA gradient lighter stop darkened so white-on-gradient passes across the full button surface.
- New top-level token blocks for surfaces that pair text with a non-default background — `tokens.hero`, `tokens.footer`, `tokens.plan` — exposed as `--brand-hero-*`, `--brand-footer-*`, `--brand-plan-*` CSS variables (see `buildCssVarMap.js`). These eliminate the "fallback chain reaches a token designed for a different surface" trap that left FooterMinimal text invisible on its own dark background, the Hero headline invisible on the dark hero surface, and the Plan card title at 1.05:1 on its dark card.

**Built-in components**

- `Home.vue` — adds a focus-visible "Skip to main content" link as the first focusable element on the page, gives `<main>` `id="main-content"` + `tabindex="-1"`, and sets `html { scroll-padding-top }` so the sticky header doesn't obscure focused targets after in-page navigation. The duplicate `<main>` previously emitted by `templates/index.html` is gone.
- `templates/index.html` — drops the outer `<main>` wrapper and adds a `<noscript>` style override that forces scroll-reveal targets visible when JS doesn't run.
- `Header.vue` — `<nav aria-label="Primary">`, descriptive `aria-label` on the home link, locale dropdown gains ESC-to-close and focus-out dismissal with focus restoration to the trigger button. Removed the mismatched `aria-haspopup="true"` on the disclosure (the dropdown isn't a `role="menu"`).
- `Hero.vue` — promotes the headline from `<h3>` to `<h1>` (every page needs exactly one h1) and demotes the eyebrow `<h2>` to a `<p>` so the document outline isn't filled with non-heading copy. Reads from `--brand-hero-text` / `--brand-hero-text-on-dark` so the dark hero surface gets light text by default.
- `Contact.vue` — every input now has a real `<label>`, plus visible required `*` indicators, `aria-required="true"`, `autocomplete` hints (`name`, `email`, `tel`), and a `role="status"` `aria-live="polite"` `#msg` region so submission feedback is announced. The challenge input is wired to its question + hint via `aria-describedby` and gets `aria-invalid="true"` on a wrong answer.
- `ComingSoonModal.vue` — captures `previousFocusedElement` on open and restores focus on close (matching `IntroGate`), close button bumped to a 32×32 hit area with AA-safe color (`#595959`) and a visible `:focus-visible` outline. Adds a global `keydown` ESC handler so dismissal works regardless of where focus is inside the dialog.
- `Footer.vue` — adds a visually-hidden "(opens in a new tab)" suffix to external links, removes the redundant `aria-label="Return home"` on the logo (the alt now reads `${siteName} – home`).
- `FooterMinimal.vue`, `Plan.vue`, `Team.vue`, `Portfolio.vue`, `StickyCTA.vue` — re-pointed text colors at the new chrome tokens so default rendering passes contrast; `Portfolio` cards' overlay link now reads `View ${project.title}` instead of the generic "Visit portfolio link"; `Portfolio` filters got a visible `:focus-visible` outline; `BackToTop` got the same.

**Migration**

Sites on `theme: "base"` will see the palette shift slightly more saturated/darker — primary blue and accent orange both deepen by a perceptual notch. Sites with custom themes are unaffected by the palette change but inherit every structural/component fix automatically. If a site relied on the old `palette.accent` orange as decorative fill, it can read `palette.accentDecorative` instead (the original `#f18f3b` is preserved under that key).

`Hero.vue`'s `<h2>` eyebrow → `<p>` and `<h3>` headline → `<h1>` is a semantic change: any CSS scoped at `:deep(.hero-eyebrow h2)` or `:deep(.hero-headline h3)` from a wrapping component would break. The class names (`.hero-eyebrow__text`, `.hero-headline`) are unchanged and remain the right hooks.

`templates/index.html` no longer wraps `#app` in a `<main>` — sites that override the template should remove their own outer `<main>` so the framework's `<main id="main-content">` (now in `Home.vue`) is the only landmark.

Tests: 336 passing (no test changes needed — the contracts are unchanged).

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
