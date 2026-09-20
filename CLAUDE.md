# CLAUDE.md — Vertex CMS

## What This Project Is

Vertex CMS (`@koehler8/cms`) — a lightweight, config-driven Vue 3 framework published to the public npm registry (`registry.npmjs.org`). Consuming sites import the Vite plugin and provide a `site/` directory with JSON config and assets — no application code needed.

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
- **404 page**: `usePageConfig.selectPage` returns a `__not_found__` sentinel with `isNotFound: true` and `components: [{ name: 'NotFound' }]` for any non-root path that doesn't match a page; sites can author `pages/404.json` to customize chrome/copy. `src/utils/notFound.js` is the single source of truth for "is this the not-found page" (matched by the reserved `404` id **or** by resolving to `/404`) and is shared by the runtime and the build. It has to be: an authored 404 carries a real `path` so the plugin can pre-render it, which makes it an ordinary route too — before this was centralized, a direct hit on `/404` matched the normal path loop, came back unflagged, and shipped with a canonical, no `noindex`, and a sitemap entry. Any new code that asks "is this a 404?" must import from there rather than comparing paths itself. The plugin pre-renders `/404` and copies `dist/404/index.html` → `dist/404.html` after the SSG render pass (`ssgOptions.onFinished`); the fleet's Amplify customRule (`/<*>` → `/404.html` @ `404`) sends unmatched URLs there (as a 302 redirect — Amplify's `404` rule type redirects rather than rewriting, and it has no native 404.html fallback; measured 2026-08-16, see workspace CLAUDE.md). `usePageMeta` skips canonical/hreflang/OG and emits `noindex` on 404s.
- **JSON-LD structured data**: pages and `site.json` accept a top-level `jsonld` key (object or array of objects). `src/utils/jsonLd.js` normalizes both into `<script type="application/ld+json">` blocks; site blocks emit before page blocks. `@context` is defaulted to `https://schema.org` when authors omit it. Drafts and 404s skip JSON-LD entirely.
- **Web App Manifest**: `vite-plugin.js`'s `writeSeoFiles` generates `siteRoot/public/manifest.json` from `site.title` / `site.description` / `site.manifest.{themeColor, backgroundColor, startUrl, display, icons}`. `templates/index.html` references it via `<link rel="manifest">` plus `<meta name="theme-color">`. `src/utils/webAppManifest.js` is the pure builder.
- **Site verification meta**: `site.siteVerification.{google, bing, pinterest, facebook, yandex}` in `site.json` emits the matching `<meta name="..." content="...">` (e.g. `google-site-verification`, `msvalidate.01`, etc.) on every page via `usePageMeta`.
- **Image variants** (beta.27+): the Vite plugin's `buildStart` hook generates `{name}-{width}.{format}` variants into `node_modules/.cache/@koehler8/cms/image-variants/{siteKey}/assets/img/...` (powered by `sharp`, lazy-imported). The asset-resolver virtual module includes a third `import.meta.glob` over the cache dir, so variants surface through Vite's normal asset pipeline (hashed, emitted to `dist/assets/`). Originals live directly in `site/assets/img/` — no `_source/` directory, no committed variant files, no preBuild script. Default matrix: 6 widths × 3 formats (avif, webp, jpg). Configurable via `site.imageVariants.{widths, formats, quality}` in `site.json`. Mtime-skip cache + manifest tracking; orphan eviction when sources are removed. Dev mode: a watcher on `site/assets/img/**` re-runs the pipeline + full-reload on source-image change. The classifier distinguishes originals from variant-shaped files by checking whether the trailing width number is in the configured widths set. Bundled components consume variants via `useResponsiveImage` (`src/utils/imageSources.js`) which builds the `<picture>` `srcset` from the asset map.
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
npx cms-validate-themes --site-dir ./site       # Bundled themes + the site's themes/<slug>/
npx cms-validate-extensions --site-dir ./site   # Site-local extensions/ + named packages;
                                                # same schema validation the Vite plugin
                                                # runs (and fails on) at build time
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

Published to the **public npm registry** (`registry.npmjs.org`) — not GitHub Packages — by the `Publish to npm` workflow (`.github/workflows/publish.yml`), which triggers on pushing a `v*` git tag.

1. Bump the version in `package.json` + `package-lock.json` (`npm version <ver> --no-git-tag-version`) and add a `CHANGELOG.md` entry.
2. Commit, then tag: `git tag v<version>`.
3. Push both: `git push origin main && git push origin v<version>`.
4. The tag push fires the workflow → `npm publish --access public`. **Prerelease** versions (those containing `-`, e.g. `1.0.0-beta.31`) publish under the **`beta`** dist-tag; stable versions go to `latest`. Consuming sites pin a `^1.0.0-beta.N` range, so a new beta is only picked up on their next `npm install` / lockfile refresh — **each site needs its own dependency bump + push to redeploy.**

The package ships as **source** (see the `files` field and the `exports` map pointing at `./src/*`), so `npm publish` just packs those files — no build step. The publish workflow's `test` job runs `npm ci --ignore-scripts` + the full Vitest suite and asserts the tag matches `package.json` before the `publish` job runs.

**Auth (OIDC trusted publishing, since 1.0.0):** no `NPM_TOKEN` secret — the workflow authenticates with its GitHub Actions OIDC identity (`permissions: id-token: write`), configured on npmjs.com under the package's **Settings → Trusted Publisher** (org `koehler8`, repo `cms`, workflow `publish.yml`). Same setup on `cms-ext-compliance`. The runner upgrades npm to 11 first (OIDC needs ≥ 11.5; the pinned Node 20.19 ships 10.8). Publishes carry provenance attestations automatically. Nothing to rotate; if a publish ever fails with an auth-shaped error, check the Trusted Publisher config on npmjs.com matches the repo/workflow names (know that npm reports scoped-publish auth failures as a **misleading `E404` on the `PUT`**, not 401). Changing publisher settings on npmjs.com prompts for the security key — that's Chris's step.

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
| 404 page / not-found behavior | `src/utils/notFound.js` (**shared detection — start here**), `src/components/NotFound.vue` (bundled fallback), `src/composables/usePageConfig.js` (selectPage flags + returns sentinel), `src/composables/usePageMeta.js` (isNotFound title/noindex), `src/utils/sitemapGenerator.js` (excludes it), `vite-plugin.js` (pre-renders /404, copies to 404.html via ssgOptions.onFinished) |
| JSON-LD / Web App Manifest / site verification | `src/utils/jsonLd.js` (page+site block normalization), `src/utils/webAppManifest.js` (manifest builder), `src/composables/usePageMeta.js` (script[] + verify meta emission), `vite-plugin.js` (writeSeoFiles writes manifest.json), `templates/index.html` (link rel=manifest + theme-color) |
| Image variants pipeline | `scripts/image-variants/` (modular: classifier, planner, renderer, manifest, cache, reconcile), `vite-plugin.js` `buildStart` hook + `configureServer` watcher (calls reconcile), `src/utils/imageSources.js` (`useResponsiveImage` runtime consumer) |
| Auto-breadcrumb JSON-LD | `src/utils/breadcrumbs.js` (path → BreadcrumbList), `src/composables/usePageMeta.js` (appends to script[]) |

## Lockfile and npm version (this is the #1 source of consumer-site deploy failures)

This repo develops and CI-tests on **Node 22.23.2 / npm 10.9** ([.nvmrc](.nvmrc), since 2026-09-19 — Node 20 went EOL 2026-04-30; 22 is the newest line still on npm 10, **never 24**, which ships npm 11). The published `engines` floor in [package.json](package.json) stays `>=20.19.0` for consumers. Consumer sites and their Amplify builds are moving 20.19.0 → 22.23.2 one at a time (`tools/fleet/node-site.sh`); until a site's own `.nvmrc` says otherwise it is still on 20.19 / npm 10.8. npm 10.9.8 was measured to leave npm-10.8-written lockfiles byte-identical, so the two coexist safely. **Local installs with a different npm version produce subtly different lockfiles** that look fine locally but break CI.

Two failure modes we've seen on consumer sites:

1. `Cannot find module '@rolldown/binding-linux-x64-gnu'` — npm 11 regen stripped optional-dep entries Amplify needs.
2. `npm ci ... Missing: @types/react@..., @noble/hashes@... from lock file` — npm 11 omitted entries npm 10 expects.

### Rules for maintainers

- **Always `nvm use` before any `npm install` or test run.** The `.nvmrc` here pins 22.23.2; your shell's npm should report `10.9.x` (in a consumer site, whatever its own `.nvmrc` pins).
- **Don't bump dep versions in this repo without `nvm use` first.** A regen on the wrong npm propagates the bad lockfile to every consumer site that picks it up.
- **Publish CI uses `npm ci --ignore-scripts`** for the test gate, on `actions/setup-node` with `node-version-file: .nvmrc`.
- **`package-lock.json`'s two self-reported `version` fields (root `.version` and `packages[""].version`) can silently drift from `package.json`'s version** if a release bump forgets them — they're metadata only (the lockfile isn't in the `files` array, so it never ships), but the drift compounds release over release if left uncorrected. Run `npm run check:lockfile-version` to detect it. Because `package-lock.json` is floored (never-touch) for every automated pipeline stage in this repo, a detected drift must be corrected by hand — edit only the two `"version"` string literals directly, outside the pipeline, with `nvm use` first; never `npm install`/`npm version`/regen to fix it.

### Rules to surface to consumer sites

Each consuming site repo (e.g. `site-coastalcollective`, `site-bang`) should:

- Carry a top-level `.nvmrc` with the same Node version, plus a CLAUDE.md note telling future sessions to `nvm use` before installing.
- Default to `npm install --prefer-offline --no-audit --no-fund` in their `amplify.yml` (NOT `npm ci`) until lockfile discipline is well-established. `npm ci` is faster but fails hard on any drift; `npm install` updates the lockfile in place during the build, so it's resilient.
- Prefer **targeted bumps** (`npm install <pkg>@<version>`) over full regen (`rm package-lock.json && npm install`). Targeted bumps preserve the rest of the lockfile; full regen on the wrong npm version strips entries Amplify needs.

The `site-coastalcollective` CLAUDE.md has a full "Lockfile and npm version" section future Claude sessions can copy into other consumer sites.

### Gating a consumer-site dependency bump

Sites have no test suite — a green `build:ssg` is their only gate, and it cannot see a stripped lockfile or a silently-vanished component. Two standalone scripts close that gap (proven on the 2026-09-19 `site-erea` canary; neither is wired into `npm test` or `builder/verify.json`, since they inspect a *site*, not this repo):

- `node scripts/check-site-lockfile.mjs <siteDir>` — every name a locked package lists under `optionalDependencies` must have a lockfile entry (the exact thing an npm-11 regen strips), both Amplify Linux binaries present with `resolved` + `integrity`, one copy each of `vue` / `vue-router` / `pinia` / `@unhead/vue`, lockfile v3. **Completeness, not a count** — rolldown 1.2.9 dropped its wasm32 binding upstream, so a healthy bump *lowered* the native-entry count.
- `node scripts/diff-ssg-dist.mjs <dist-before> <dist-after>` — build before and after the bump, then diff the route list and, per page, title / description / robots / canonical / hreflang / og / JSON-LD, section-heading-link-image counts and visible text, plus `sitemap.xml` and `robots.txt` bytes, plus the **theme fingerprint** (the set of CSS custom-property declarations in `dist/assets/*.css` — the page diff never opens a stylesheet, so a palette/type regression was otherwise invisible).

The two fleet drivers live in `tools/fleet/` — deliberately **outside** `package.json` `files`, so they never ship to npm:

- `tools/fleet/bump-site.sh <site-dir> [phase]` — one site through the whole gated recipe: `pre` (toolchain, clean tree, in sync with origin, no PRs, no `bm/*` branches) → `baseline` (replays the site's own `amplify.yml` preBuild `npm run` steps, **skipping `fetch:*`** so a live feed can't dirty the tree or the diff) → `bump` (believes `npm outdated`, not `npm update`'s exit code; fails if a frozen package moved) → `gates` → `rehearse` (Amplify's exact install leaves the lockfile byte-identical; `npm ci`; a linux-x64 install materialises both native bindings) → `after` (equal HTML count, `diff-ssg-dist`, never-touch files, every `builder/checks` + canon scanner). **It never commits or pushes**, exits non-zero at the first failed gate, and restores `package.json` + the lockfile if it fails after bumping. A re-run on a current site is a no-op PASS. Appends one JSON line per site to `$FLEET_SCRATCH/ledger.jsonl`.
- `tools/fleet/verify-live.sh <site-dir> [vue-version]` — after a push: the Amplify job for `HEAD` (the console's all-apps "Updated" column is *settings* time, not deploy time), every sitemap URL ends at 200 (following the no-trailing-slash 301), and the **embedded Vue version** in the live bundle, searched across every chunk with `--compressed` (asset hashes differ between a Mac and Amplify's Linux build, and the string is not always in `vendor-vue-*`). One look, no waiting: exits 3 while the job is pending. `verify-live.sh <site-dir> snapshot`, run before a push, records the live entry-asset names so the post-push run can also require that **the build changed** — essential for a framework-only release, where the Vue version is identical before and after and nothing else in the bundle identifies the build.
- `tools/fleet/ship-site.sh <site-dir> [note]` — commits and pushes a site the driver marked READY, with a commit message generated from that site's own ledger numbers. Refuses unless the ledger's *last* entry is READY, only `package.json` / the lockfile changed, and `origin/main` has not moved; takes the live snapshot; **fails loudly on a rejected push** (`site-bang`'s `main` is protected and requires the `verify` check — that repo goes through a PR). `COMMIT_TRAILER` carries the operator's own attribution.

- `tools/fleet/node-site.sh <site-dir> [phase]` — the sibling driver for the opposite change: **Node moves, nothing else may.** `pre` → `baseline` (built under `NODE_FROM`) → `switch` (edits exactly `.nvmrc` and the one `nvm install … && nvm use …` line in `amplify.yml`, asserted as one line each) → `install` → `rehearse` → `after` (same `diff-ssg-dist` + checks as the bump driver). `package.json` and the lockfile must come out byte-identical at every step — a lockfile that wants to change under the new npm is a finding to stop on. Never commits or pushes; restores the two files if it fails after switching; `NODE_PIN == NODE_FROM` is a supported no-op proof run. Ship with `SHIP_MODE=node tools/fleet/ship-site.sh <site>` (allow-list becomes exactly `.nvmrc amplify.yml`; a READY verdict from one track never ships the other), verify with `NODE_WANT=<pin> NPM_WANT='10.9.*' tools/fleet/verify-live.sh <site>`. Three things it encodes (measured 2026-09-19, 20.19.0 → 22.23.2): **(1)** npm 10.9.8 leaves an npm-10.8-written lockfile byte-identical — no-op install, `npm ci`, *and* a targeted write; **(2)** `amplify.yml` caches `node_modules/**`, so the first build on the new Node runs on a tree installed under the old one — safe only because every native binary in a site tree is N-API (canvas 3.x, sharp, rolldown, lightningcss), which `install` asserts per site (`nm` for `node_register_module_v*`) before replaying the preBuild steps on the old tree; **(3)** a Node-only change need not move a single asset hash, so the proof of deploy is the Amplify **build log** (`Now using node v<pin> (npm v…)`, every occurrence), not the bundle. Noise floor worth knowing: two builds on the *same* Node are not byte-identical either — vite-ssg renders concurrently, so the order of a page's preload hints varies (site-erea: 3 of 62 pages); hashed asset names are stable.

- `tools/fleet/bump-product.sh <repo-dir> [phase]` — the driver for the **non-site products** (`buildmill`, `entourage`, the three engines): repos that HAVE a test suite and have no SSG `dist` to diff. Phases `pre → baseline → bump → gates → rehearse → verify` (+ `restore`); never commits, never pushes; restores `package.json` + the lockfile on any failure after bumping; a no-op run with `BUMP_NAMES=""` is a supported proof. Per-repo knobs are env vars it never guesses: `BUMP_NAMES` (explicit `npm update` names), `WEB_BUILD`, `ALLOW_DIRTY` (engine-mintmill's SST-generated `sst-env.d.ts`), `IGNORE_PRS`, `FREEZE_PREFIXES`. Its real output is the **full list of lockfile entries whose version changed**, printed for a human to read, plus hard assertions that nothing held moved. Proven across all five products 2026-09-20 (Track 1). Five things it encodes, each because it produced a FALSE GREEN first: **(1)** a test-count parser that doesn't know the runner reports **0/0/0**, which is indistinguishable from a passing suite — it parses both vitest and `node --test` TAP and **refuses a zero-test baseline outright**; **(2)** `npm update` exits 0 and silently moves nothing for workspace-declared packages, so "how many moved" is not a gate — it asserts against `npm outdated` that **nothing requested is still behind**; **(3)** `npm ls --all` is *already* invalid at HEAD in all three engines (`@tensor-foundation/marketplace` nests `@solana-program/system` peer-wanting `@solana/web3.js@2.0.0-rc.4`), so the gate is **baseline-relative**, not absolute; **(4)** a named HELD list cannot cover a family — numuse locks **18** `@metaplex-foundation/umi*` packages while `overrides` names four — hence `FREEZE_PREFIXES`; **(5)** workspace *link* entries carry no `.version`, so a naive lockfile diff reports them as appearing/disappearing on an unchanged file. Outside the driver but part of the recipe: always run `sst diff` **twice** — once on the bumped tree and once on the pre-bump lockfile — or pre-existing stage drift reads as your own resource changes.

**Rolling a new cms release across the fleet** is `CMS_ONLY=1 CMS_TARGET=<ver> tools/fleet/bump-site.sh <site>`: only cms is installed and the driver asserts that the lockfile changed in exactly two entries (the root's declared range and `node_modules/@koehler8/cms`), so nothing else published that day can ride along. Valid only when the release left this package's `dependencies` / `peerDependencies` alone — check `git diff vA vB -- package.json` first. Other knobs, each added because a real site needed it: `EXACT_TARGETS="vite@8.3.0 vue@3.5.43"` (site-buildmill pins without a caret), `IGNORE_PR_BRANCHES`, `ALLOW_BM_BRANCHES=1`, and `NODE_PIN` / `NPM_PIN` (default `22.23.2` / `10.9.*` since 2026-09-20; the site's `.nvmrc` must agree, so a site that has moved to another Node fails `pre` loudly until the operator names its pin — the bump driver never moves a site's Node).

**Two passes CMS_ONLY cannot express**, added 2026-09-20 for the framework-majors track. Both are enforced by the same gate — `tools/fleet/check-lockfile-drift.mjs`, specced in `tests/scripts/checkLockfileDrift.spec.js` — whose rule is: *every lockfile entry that changed must be one of the packages you named, or reachable from one of them through the lockfile's own dependency graph.* It prints that list for the operator, and `ship-site.sh` writes the commit message from it rather than from a fixed package list (which could not see `ethers`).

- **`NAMED_ONLY="ethers viem ws"`** — move transitive packages *by name* and nothing else. `CMS_TARGET` is still required but is an **assertion** here, never an install: a commit that says "ethers 6.16 → 6.17" must not also carry a cms bump it never mentioned. `package.json` must come out untouched, and every `FROZEN` package the operator did not name is still checked by name. This is what clears the `ws` advisory on the nine crypto-declaring sites: `ethers` 6.16.0 pins `ws` 8.17.1 *exactly*, 6.17.0 pins 8.21.0, and nothing is published to make that happen.
- **`CMS_PLUS="pinia @vue/devtools-api"`** — a framework release that legitimately brings a bundled runtime dependency with it (cms 1.4.0 carries pinia 4), where CMS_ONLY's "exactly two entries moved" is the wrong invariant. A name given as `name@version` is **installed** at that version in the *same* `npm install` as cms, so their peers resolve against each other; a bare name is allow-listed only. On top of the drift rule it asserts **exactly one copy of `pinia`** (cms hands one instance to every extension) and that every declared `pinia` peer in the tree is satisfied (`vue-router`'s, and any extension's). **A bare name is `npm update`d, not installed** — `npm install pinia@X` would write pinia into the site's own `package.json`, and no site declares the store the framework bundles.

Three deliberate choices in that gate, each a place a looser rule lets something through: **peers are not edges** (naming cms must not license a `vue` move), **"changed" means the whole entry**, not just `.version` (a rewritten dependency map is worth seeing), and the range matcher **refuses syntax it does not fully implement** — hyphen ranges, `x` wildcards, prereleases — so an unreadable range fails the gate instead of being guessed at.

Two npm 10.8 traps specific to *this* repo, where `vite`, `vue` and `vue-router` are both peer and dev dependencies: `npm update vite` crashes arborist (`#loadPeerSet` → `Cannot read properties of null (reading 'edgesOut')`), and `npm update` silently leaves `vue`, `vue-router`, `vitest` and `@vitest/coverage-v8` where they were. Use a targeted `npm install <pkg>@<ver> --save-dev` and **confirm each version actually moved**. Consumer sites are unaffected — `npm update` works there.

## Accessibility (WCAG 2.2 Level AA — hard requirement)

**Every consumer site that ships on this framework must meet WCAG 2.2 Level AA.** Real-estate, hospitality, retail, and similar public-accommodation sites are frequent ADA-lawsuit targets in the US, and AA is the de facto benchmark courts apply. The framework itself was audited and brought to AA in `1.0.0-beta.17` ([CHANGELOG](CHANGELOG.md#100-beta17)) — the bundled components, the `base` theme, and the page wrapper all conform out of the box. Don't regress that, and don't ship a feature that re-introduces a failure pattern.

### What "AA-compliant" means in practice for this codebase

The framework guarantees these for any consuming site that uses the bundled `Home.vue` wrapper, the bundled components, and the `base` theme:

- **Skip link** to `<main id="main-content">` as the first focusable element on the page (WCAG 2.4.1 Bypass Blocks).
- **`<html lang>` matches the rendered language** (3.1.1 Language of Page). A saved locale is restored onto unprefixed URLs, so the text at `/` can be German; `Home.vue` therefore keys `usePageMeta` off `usePageConfig`'s `contentLocale` (the locale whose content is applied), never the route param. Don't pass `props.locale` to `usePageMeta` again. Pinned by `tests/composables/contentLocale.spec.js`.
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

- **No pre-bundling for vue/vue-router/pinia**: These are excluded from Vite's optimizer to prevent duplicate module instances when extensions are linked.
- **cookieConsent analytics default**: `shouldEnableAnalytics()` returns true when consent is pending (analytics load before explicit consent). See the GDPR note in that file.
- **canvas dependency**: `optionalDependency` (with `png-to-ico`, `dotenv`) used only by `generate-public-assets`. npm skips it if its native build fails (needs cairo/pango on platforms without prebuilds) — installs stay green, and the command itself fails loudly with install instructions when it's missing.
