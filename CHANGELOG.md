# Changelog

## 1.0.0-beta.23

### Fix: locale discovery missed translation-only locale dirs

beta.19 introduced on-disk locale discovery to replace the
hardcoded-15-locales fanout. The check required `site.json` to be
present in each locale dir. That was overly strict: many sites author
per-locale page overrides (`pages/home.json` etc.) and a per-locale
`shared.json` without overriding the site metadata, since the brand
name typically stays the same across languages. Those locales were
silently dropped from `availableLocales` after beta.19, which made:

- The bundled `Header` locale dropdown disappear (it hides when
  `availableLocales.length <= 1`).
- Per-locale URLs stop pre-rendering.
- `hreflang` alternates collapse to a single locale.

`coastalcollective.life` exhibited all three after its beta.22 bump.

**Fix:** discovery now treats a locale directory as present if any of
`site.json`, `shared.json`, or a `pages/` subdir exists — matching the
pre-beta.19 glob-based behavior. Sites with the translation-only
scaffolding pattern (no per-locale `site.json`) start being recognized
again with no per-site changes.

Tests: 557 still passing. Verified end-to-end on a coastal-pattern
fixture (locale dirs with `shared.json` + `pages/home.json`, no
`site.json`): all locales discovered, pre-rendered, and hreflang
alternates emit correctly.

## 1.0.0-beta.22

### Image-variant pipeline + auto-generated breadcrumb JSON-LD

**Image-variant pipeline (Tier-3 #1)**

`useResponsiveImage` has been wired into the bundled components for ages,
but the build never produced the variant files it expects. Sites were
shipping a single full-size JPEG and `srcset` rendered empty. New script
fixes that by generating the matrix at build time.

- New `scripts/generate-image-variants.js` + `bin/cms-generate-image-variants.js`.
- New convention: drop originals at `site/assets/img/_source/{name}.{ext}`.
  The script reads them and writes `{name}-{width}.{format}` variants
  back to `site/assets/img/`. Subdirectory layout is preserved.
- Default matrix: widths `[320, 640, 960, 1280, 1920, 2560]` × formats
  `[avif, webp, jpg]` = 18 variants per source. Configurable via
  `site.imageVariants.{widths, formats, quality}`.
- Sources smaller than a requested width are clamped (no enlargement).
- mtime-based skipping: re-running the script only regenerates variants
  whose source has changed since the last run.
- Powered by [`sharp`](https://sharp.pixelplumbing.com/) (new dependency).
  Native binaries prebuilt for darwin/linux x64+arm64 — no system
  libraries to install on AWS Amplify.

**Wire-up in consumer sites** (one-time):

1. Move existing flat `site/assets/img/*.{jpg,png}` originals into
   `site/assets/img/_source/`.
2. Add to `package.json` scripts:
   `"generate:image-variants": "cms-generate-image-variants --site-dir ./site"`.
3. Add to `amplify.yml` preBuild commands:
   `npm run generate:image-variants` (before `generate:public-assets`
   and `build:ssg`).
4. First build generates the matrix; subsequent builds reuse it.

**Auto-generated breadcrumb JSON-LD (Tier-3 #6)**

`usePageMeta` now emits a `BreadcrumbList` schema for any non-home,
non-draft, non-404 page with `site.url` set. Drives Google's breadcrumb
display in search results without authors having to write the schema.

- New `src/utils/breadcrumbs.js` (pure helper).
- Path → segment list → `ListItem` entries. First entry is always
  `Home` linked at the canonical home URL; subsequent entries are each
  prefix path of the current URL.
- **Label resolution priority** per intermediate path:
  1. If a page exists at that path, use its `meta.title`.
  2. Otherwise, format the slug (`our-team` → `Our Team`).
- The leaf entry (current page) DOES include its `item` URL — Google
  accepts both forms; including is more interoperable.
- **Skipped on**: home, drafts, 404s, missing `site.url`, single-locale
  home page with `/` path.
- **Per-page opt-out**: `pages/{id}.json` `meta.breadcrumbs: false`.
- Locale-prefixed URLs: non-base locales render breadcrumb item URLs
  with the `/{locale}/...` prefix; the path-segment hierarchy itself
  doesn't include the locale prefix as a step.

**New files:**

- `scripts/generate-image-variants.js` — orchestrator + sharp pipeline
- `bin/cms-generate-image-variants.js` — CLI wrapper
- `src/utils/breadcrumbs.js` — `buildBreadcrumbList(...)`
- `tests/scripts/generate-image-variants.spec.js` (18 tests, fixture-driven)
- `tests/utils/breadcrumbs.spec.js` (17 tests)

**Edits:**

- `package.json` — add `sharp ^0.33.5` dep + new bin entry
- `src/composables/usePageMeta.js` — appends BreadcrumbList JSON-LD after
  any author-supplied `jsonld` blocks. Authors can override by emitting
  their own hand-authored `BreadcrumbList` in `pages/{id}.json` `jsonld`.

**Caveats:**

- **Migration is mandatory** for the image pipeline to actually do
  anything. Sites that don't move originals into `_source/` keep
  shipping single-size JPEGs (no regression — `useResponsiveImage`
  already falls back gracefully — but no improvement either).
- **AVIF encoding is slow.** A 2560-wide AVIF can take 1–3 seconds per
  source. Run on developer machines or CI before pushing; don't
  regenerate on every Amplify build (mtime-skip handles repeat runs).
- **`sharp`'s install size** is ~50MB. Acceptable trade for the format
  support (`canvas`-based generation can't produce AVIF).
- **Breadcrumb schema is opt-out, not opt-in.** Sites that don't want
  breadcrumb display in Google should set `meta.breadcrumbs: false` on
  pages where it's misleading (rare).

Tests: 557 passing (18 new for image-variants, 17 for breadcrumbs, 8
added to usePageMeta).

## 1.0.0-beta.21

### Per-page JSON-LD, Web App Manifest, and Search Console verification hooks

Three Tier-2 SEO/PWA additions, all opt-in and additive:

**Per-page JSON-LD structured data**

- New `src/utils/jsonLd.js` builds `<script type="application/ld+json">`
  blocks from per-page and per-site `jsonld` keys.
- Authors add either an object or an array of objects in `pages/{id}.json`:

  ```json
  "jsonld": {
    "@type": "RealEstateAgent",
    "name": "Jamie Austin",
    "telephone": "+1-310-806-3199",
    "image": "https://ocandme.com/img/jamie.jpg"
  }
  ```

  or several:

  ```json
  "jsonld": [
    { "@type": "Article", "headline": "..." },
    { "@type": "BreadcrumbList", "itemListElement": [ ... ] }
  ]
  ```

- Site-wide additions (e.g. a `WebSite` with sitelinks-search-box) live
  under `site.jsonld` in `site.json`. Page blocks append after site blocks.
- `@context` is auto-injected with `https://schema.org` if the author
  omits it.
- Drafts and 404 pages skip JSON-LD entirely (gated/missing content
  shouldn't make schema.org claims).

**Web App Manifest (`/manifest.json`)**

- The plugin's `writeSeoFiles` now generates `siteRoot/public/manifest.json`
  from `site.title`, `site.description`, and an optional `site.manifest`
  block. Defaults work out of the box: `start_url=/`, `display=standalone`,
  fallback theme/background `#ffffff`, icons referencing
  `/favicon-256.png` and `/favicon.ico` (both written by
  `cms-generate-public-assets`).
- Per-site overrides via `site.manifest.{name, shortName, themeColor,
  backgroundColor, startUrl, display, lang, description, icons[]}`.
- `templates/index.html` now emits `<link rel="manifest"
  href="/manifest.json">` and `<meta name="theme-color" content="...">` so
  iOS/Android Add-to-Home-Screen works and the mobile chrome bar takes
  the brand color.

**Search Console / webmaster verification meta**

- New `site.siteVerification` object in `site.json` keyed by platform:

  ```json
  "siteVerification.google": "abc123token",
  "siteVerification.bing": "...",
  "siteVerification.pinterest": "...",
  "siteVerification.facebook": "...",
  "siteVerification.yandex": "..."
  ```

- `usePageMeta` emits one `<meta name="...">` per token using the
  platform's standard meta name (`google-site-verification`,
  `msvalidate.01`, `p:domain_verify`, `facebook-domain-verification`,
  `yandex-verification`).
- Empty/whitespace tokens and unknown platforms are silently skipped.
- Emitted on every page (verification platforms typically only check
  homepage; emitting site-wide is harmless and matches industry default).

**New files:**

- `src/utils/jsonLd.js` — `buildJsonLdScripts(...)` (12 tests)
- `src/utils/webAppManifest.js` — `buildWebAppManifest(...)` (15 tests)
- `tests/utils/jsonLd.spec.js`, `tests/utils/webAppManifest.spec.js`

**Edits:**

- `src/composables/usePageMeta.js` — now also emits `script: [...]` for
  JSON-LD and additional verification `<meta>` tags via `useHead`.
- `vite-plugin.js` — `writeSeoFiles` writes `manifest.json` alongside
  `robots.txt` and `sitemap.xml`. `extractSiteMetadata` exposes
  `manifestThemeColor` for the template.
- `templates/index.html` — adds `<link rel="manifest">` and
  `<meta name="theme-color">`.

**Caveats:**

- **Theme color in `<meta name="theme-color">` is static per build** (read
  from `site.manifest.themeColor`). It doesn't auto-derive from theme
  tokens — sites should set it explicitly to match their brand.
- **No JSON-LD validation.** Whatever the author writes is emitted as-is.
  Use Google's Rich Results Test to validate before relying on rich
  results.
- **PWA-installable scope.** Just shipping `manifest.json` doesn't make
  the site fully PWA-installable; that requires a service worker, which
  is out of scope. The manifest covers what most marketing sites need
  (Add to Home Screen, splash colors, app-like icon).

Tests: 515 passing (12 new for `jsonLd`, 15 for `webAppManifest`, 9
added to `usePageMeta` for JSON-LD + verification).

## 1.0.0-beta.20

### Per-page Open Graph + Twitter Card meta and a real 404 page

Two SEO/UX gaps closed in one release:

1. **Per-page link previews**: every page now emits its own `og:title`,
   `og:description`, `og:url`, `og:image`, `og:type`, `og:site_name`,
   plus the matching `twitter:*` tags. Sharing `/about` to iMessage,
   Slack, X, etc. now shows the page-specific card instead of the
   site-wide one. Sites/pages can override the image and og:type per
   page via `meta.image` / `meta.ogType` / `meta.twitterCard`.
2. **Real 404 page**: unknown URLs render a bundled `NotFound`
   component with HTTP 404 (via Amplify's auto-served `dist/404.html`)
   instead of silently rendering the home page with HTTP 200.

**Schema additions** (all optional):

- `pages/{id}.json`
  - `meta.image` — per-page OG/Twitter image (relative path or absolute
    URL). Falls back to `site.image` then to the static `/og-image.jpg`.
  - `meta.ogType` — overrides default `"website"` (e.g. `"article"`).
  - `meta.twitterCard` — overrides default `"summary_large_image"`.
- `site.json`
  - `image` (or `ogImage`) — site-wide OG image fallback when a page
    doesn't set its own.
- `pages/404.json` (optional) — a custom 404 page. If present,
  `selectPage` resolves to it on no-match. Its `components[]` can list
  Header/Footer/etc. for full chrome. If absent, a synthesized sentinel
  renders just the bundled `NotFound` component (no chrome).
- `shared.json` / `pages/404.json` `content.notFound`
  - `heading` — defaults to "Page not found"
  - `body` — defaults to "We couldn't find the page you're looking for."
  - `homeLabel` — defaults to "Return home"
  - `homeHref` — defaults to "/"

**Behavior:**

- `usePageMeta` now produces `<title>`, `<meta name="description">`,
  `<meta property="og:*">`, `<meta name="twitter:*">`, `<link
  rel="canonical">`, and `<link rel="alternate" hreflang>` per page.
  The static `templates/index.html` no longer hardcodes any of those
  (was previously: `<title>` + meta description + 9 OG/Twitter tags
  rendered with site-wide constants on every page). The site-wide JSON-LD
  Organization snippet stays in the template — that's per-page invariant.
- 404 pages get `<title>Page not found — {Site}</title>`, empty
  description, `<meta name="robots" content="noindex, nofollow">`, no
  canonical, no hreflang, no OG/Twitter (the URL the visitor typed
  shouldn't generate a misleading link card if shared).
- The vite-plugin pre-renders `/404` (via `staticRoutes`) and copies
  `dist/404/index.html` → `dist/404.html` after rendering, in
  `ssgOptions.onFinished`. AWS Amplify auto-serves the top-level
  `404.html` for unmatched URLs with HTTP 404 status — no per-site
  config needed.
- `usePageConfig.selectPage` returns a not-found sentinel
  (`{ id: '__not_found__', isNotFound: true, components: [{ name:
  'NotFound' }] }`) when the requested path doesn't match any page and
  isn't `/`. Sites can override by authoring `pages/404.json`. The
  previous behavior — "fall through to home content with HTTP 200" — is
  gone. **This is a breaking change in observable behavior**:
  previously, hitting `/this-doesnt-exist` rendered the home page; now
  it renders a 404. Any site that depended on the old behavior should
  audit (rare; the old behavior was almost always wrong for SEO).

**New files:**

- `src/utils/socialMeta.js` — `buildSocialMeta(...)` returns the
  per-page OG/Twitter meta entries. Pure; tested in isolation.
- `src/components/NotFound.vue` — bundled fallback rendered for the
  `__not_found__` sentinel. Theme-token styled, WCAG 2.2 AA (real
  heading hierarchy, focus-visible, prefers-reduced-motion, ≥24×24 hit
  area on the home link).
- `tests/utils/socialMeta.spec.js` — 19 cases covering the meta-tag
  emission paths.

**Edits:**

- `src/composables/usePageMeta.js` — extended with OG/Twitter emission
  via `buildSocialMeta` and `isNotFound` handling. Drafts already
  skipped canonical/hreflang; now they (and 404s) also skip OG/Twitter.
- `src/composables/usePageConfig.js` — `selectPage` returns a
  `__not_found__` sentinel for any non-root path that doesn't match a
  page. Sites can author `pages/404.json` to customize.
- `vite-plugin.js` — adds `/404` to `includedRoutes`; new
  `ssgOptions.onFinished` callback copies `dist/404/index.html` →
  `dist/404.html` after pages are rendered.
- `templates/index.html` — removes the EJS-rendered `<title>`,
  `<meta description>`, og:*, and twitter:* lines. Adds an inline
  comment noting that those are now per-page emissions.
- `tests/composables/usePageMeta.spec.js` — adds 8 OG/Twitter cases
  + 7 NotFound cases.

Tests: 471+ passing (19 new for socialMeta, 8 added to usePageMeta for
OG/Twitter, 7 for 404 handling).

**Caveats:**

- **HTTP 404 status depends on the host.** The framework writes
  `dist/404.html`; making it serve with a 404 status code is the host's
  job. AWS Amplify does this automatically when `404.html` exists at
  the root of the deployed site. Other hosts (Netlify, Cloudflare
  Pages, S3) need their own configuration — document per host as needed.
- **Sites that customize `templates/index.html`** (rare — there's no
  documented way) lose the site-wide OG/Twitter site-wide fallback.
  In practice no consumer site does this; the template is internal.

## 1.0.0-beta.19

### Canonical URLs — collapse the URL space to one per page

Pages used to render at multiple URLs (`/about`, `/en/about`, `/de/about`,
…), all serving identical content. This release picks one canonical URL
per page, stops emitting the duplicates, and adds the SEO link tags that
let crawlers handle the remaining edge cases. Wins: cleaner SEO,
smaller `dist/` for sites that scaffolded extra locales, no more
duplicate-content risk in Search Console.

**URL space rule (matches Google / Stripe / GitHub conventions):**

- Base locale → `/path` (no prefix).
- Non-base locales actually populated on disk → `/{locale}/path`.
- Trailing slash → no slash; recommended Amplify 301 (see "URL hygiene"
  in `CLAUDE.md`).

**Breaking changes:**

- **URL space**: `/{baseLocale}/path` (e.g. `/en/about` on a US site)
  no longer pre-renders, no longer routes via the locale layout, and is
  no longer listed in `sitemap.xml`. Direct hits fall into the SPA
  catch-all → home fallback (HTTP 200) until the separate 404-page
  feature lands. Sites with inbound external links to old URLs should
  add an Amplify 301 rule from `/<baseLocale>/<*>` → `/<*>`.
- **SSG output**: non-base locale URLs (`/de/about`, etc.) are emitted
  only when `site/content/{locale}/site.json` exists. Empty locale dirs
  no longer produce phantom localized routes. Expect `dist/` to shrink
  for any site that scaffolded all 15 supported locales without filling
  them in.
- **Plugin API**: the `locales` plugin option is removed (auto-discovered
  from disk now). Verified by grep — no consumer site passes it.

**Added:**

- `<link rel="canonical" href="...">` per page in the rendered `<head>`.
  Drafts skip it (gated content shouldn't advertise an authoritative URL).
  Sites without a configured `site.url` skip it (can't build absolute).
- `<link rel="alternate" hreflang="...">` per available locale plus
  `x-default` for multi-locale sites. Single-locale sites emit none.
- `<xhtml:link rel="alternate">` annotations in `sitemap.xml` for
  multi-locale sites. Single-locale output is byte-identical to before.
- New `src/utils/canonicalUrl.js` — single source of truth for the URL
  formula, used by `usePageMeta`, `sitemapGenerator`, and any future
  consumer that needs an absolute canonical URL.
- New exports from `virtual:cms-config-loader` and the `loadConfig.js`
  singleton: `baseLocale` (the active site's base locale, build-time
  string literal). `availableLocales` is now also a build-time literal
  derived from on-disk content discovery (was previously discovered from
  Vite glob keys).
- New helper `buildRoutes(localePrefixes)` exported from
  `src/router/index.js` — used by tests to validate the locale regex
  generation; default `routes` constant computes the prefixes from the
  loadConfig singletons at module load time.

**Caveats:**

- **No true 404 yet.** Stale `/en/about`-style URLs render the home
  page (HTTP 200) instead of returning a 404. The 404-page feature is
  separate work; pair the two for a fully clean URL space.
- **Sitemap-index for very large sites** is still future work. Today's
  sitemap is single-file; sites with 1000+ pages or many locales may
  want a sitemap-index later.
- **Multi-locale sites with empty/sparse locale dirs.** This PR's
  on-disk discovery only counts dirs that contain `site.json`. Some
  sites (notably the 9 with all 15 locale dirs scaffolded) may have
  `de/site.json` etc. with placeholder-only content. Those are still
  emitted today; cleanup is per-site work — drop the dirs you don't
  use.

Tests: 445 passing (12 new for `canonicalUrl`, 7 added to
`sitemapGenerator`, 9 added to `usePageMeta`, 13 in router after
refactor).

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
