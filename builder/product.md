# Product facet — Vertex CMS (cms)

> Read by buildmill's product agent and pipeline stages. Sole member repo: this facet IS the
> composite product skill for `@koehler8/cms`.

## What this is

Vertex CMS — the `@koehler8/cms` framework: a lightweight, config-driven Vue 3 + vite-ssg
substrate published to the public npm registry. It is the **shared foundation under ~26 live
consumer sites** (`site-*` repos). Each consumer is a thin shell — a `vite.config.js` that
imports `@koehler8/cms/vite` plus a `site/` directory of JSON content and assets — so the
framework carries all the heavy lifting: routing, locale resolution, draft gating, canonical
URLs, per-page meta, JSON-LD, sitemap/robots, the image-variant pipeline, and the
accessibility scaffolding. The mission is leverage with safety: **let a non-developer grow a
professional, accessible, SEO-correct site by editing JSON, and never ship a framework change
that regresses that promise or breaks the fleet.**

The repo is the framework core (Vite plugin, bundled components, composables, utils, the
`base` theme) plus a Vitest suite (`tests/` mirrors `src/`). Node 20.19 / npm 10.8, pinned to
AWS Amplify parity for every consumer.

**Merge is not release, and release is not deploy.** Publishing `@koehler8/cms` is a *manual*
step — bump `package.json` + `CHANGELOG.md`, `git tag v<version>`, push the tag → the
`publish.yml` workflow runs `npm publish` (prereleases go to the `beta` dist-tag). A merged PR
does **not** cut a release, and consumer sites pick up a new beta only on their own
`npm install` + push. Two human-gated buffers sit between any merged change here and a live
site. Grooming and the pipeline open PRs; they never tag or publish.

## Goals (checkable)

The product goal is the consumer's experience and the fleet's safety, not this repo's CI for
its own sake. Grooming surveys these outcomes:

- **Authoring-is-JSON stays true.** A consumer grows their site by editing flat dot-notation
  page keys — the framework inflates them, resolves components three tiers deep (site-local →
  extension → bundled), and renders. Checkable: the bundled components and config loader keep
  their documented contracts; the test suite covers the resolution/inflation paths.
- **Locale, canonical, and SEO correctness hold.** One URL formula (`canonicalUrl.js`) drives
  canonical + hreflang + sitemap; base locale unprefixed, other locales at `/{locale}/path`;
  drafts noindex with only the gate on disk; 404s emit real HTTP 404 via the pre-rendered
  `404.html`. These are the framework's contract with every consumer's search ranking — a
  regression here is a fleet-wide SEO incident. Checkable: the canonical/sitemap/draft/404
  utils and their specs stay green and unbroken.
- **WCAG 2.2 AA is a hard requirement, not a stretch goal.** For any consumer on the bundled
  components + `base` theme + `Home.vue` wrapper: skip link, single `<main>` landmark, focus
  management, `prefers-reduced-motion`, real labels, and a `base` palette where every
  text/bg pair meets 4.5:1 (text) / 3:1 (large text + non-text UI). Consumer sites are
  frequent ADA-lawsuit targets; AA is the benchmark courts apply. Checkable: the audit-script
  pattern in `CHANGELOG.md` (`1.0.0-beta.17`) recomputes contrast; heading order, landmarks,
  and focus rules survive any component/theme change.
- **The framework stays healthy enough to keep the above true** — the Vitest suite is green
  on main, the release path works, docs match behavior (mechanics live under Quality bars;
  they serve the mission, they are not it).

**Product-agent contract:** each grooming run, propose AT MOST ONE evidence-backed intent, and
only when the evidence earns it. When nothing qualifies, say so and propose nothing —
**restraint is the correct output of most runs.** This is crown-jewel infrastructure; a churned
proposal is worse than silence.

## Direction (current)

This loop is **SUPERVISED** — pull mode is OFF and every judgment gate is always-HITL; Chris
gates every merge in the console. Grooming's bar is therefore evidence, not ideas: a failing or
missing check, an observe finding (broken release, red main, a shipped beta breaking a
consumer), a reproduced bug in a bundled component or util, an accessibility regression against
the AA guarantees, or a documented gotcha that has bitten a consumer site and can be fixed at
the framework layer. Tie every proposal to a concrete symptom and keep it to one per run.

Lanes that stay Chris's alone, even as proposals:
- **Framework API shape and breaking changes.** New public config keys, component contracts,
  or anything that changes how consumers author — these are design decisions with ~26-site
  blast radius. Grooming may surface the need with evidence; it does not decide the design.
- **Toolchain and major dependency direction** (see Dependency posture) — the fleet defers
  these *up to here*, and here they are Chris's deliberate call, not a grooming proposal.
- **Release cutting.** Version bumps, tags, `CHANGELOG` release headers, and publishing are
  operator actions. A merged PR is the deliverable; never assume it is published.

## Quality bars

The mechanics that serve the mission:

- **The verify gate is `npm ci` + `npm test`** (`builder/verify.json`): the full Vitest suite
  (happy-dom + @vue/test-utils) must pass before any PR. `verify-must-run` is floored — it is
  the deterministic backstop that stands under the human gate.
- **Re-verify accessibility when you touch it.** Any change to a bundled component's markup or
  CSS, a theme palette, or `Home.vue`/`templates/index.html` re-checks heading order,
  landmarks, focus (`:focus-visible` must survive), target sizes (≥24×24px), `prefers-reduced-
  motion`, and contrast per the `beta.17` audit pattern. Never add `outline: none` without a
  replacement; never drop the skip link or the single-`<main>` invariant. If preserving AA
  needs a structural change you're unsure about, stop and ask — do not merge a guess.
- **Silent-render + external-image gotchas are framework knowledge.** Components are
  `v-if`-gated against their content block (a referenced component with no `content.*` keys
  renders nothing, silently); Unsplash CDN URLs need the numeric CDN photo ID, not the page
  slug. Fixes that touch these paths keep the documented behavior.
- **Locale parity in tests.** Multi-locale utils (canonical, hreflang, sitemap alternates)
  keep their spec coverage; don't land a URL-formula change without its test.
- **Load-bearing invariants — do not "clean up":** the `scripts/patch-lru-cache-tla.js`
  postinstall patch (Node 20 TLA compat), the exclusion of vue/vue-router/pinia from Vite
  pre-bundling (prevents duplicate module instances across linked packages), and the
  `.cms-entry.js` singleton wiring. Removing any of these breaks consumers in ways the unit
  suite may not catch.

## Dependency posture (read before proposing bumps)

Vertex CMS is **where the fleet's framework-level dependency decisions are made** — every
consumer site's facet explicitly defers toolchain and major bumps (vite, vue, vue-router,
`@vitejs/plugin-vue`, vite-ssg, `@koehler8/cms`) *up to here*. That makes dep changes here the
highest-blast-radius edits in the whole portfolio, and it makes them **Chris's deliberate,
supervised call — not routine grooming proposals.**

- **`package-lock.json` is floored (`never-touch`).** The #1 cause of consumer-site deploy
  failures is a lockfile regenerated on the wrong npm version (npm 11 strips optional-dep
  entries Amplify needs, or omits entries npm 10 expects). Chris drives dep sweeps by hand
  with `nvm use` first and targeted `npm install <pkg>@<ver>` — never a full regen. Grooming
  does not touch the lockfile, so dependency bumps are out of its routine scope.
- If a dependency issue is real (a security advisory, a broken transitive), grooming may
  **surface it as evidence** for Chris to action deliberately — it does not open the bump.
- Never propose a major of anything, and never propose a toolchain bump, as pipeline work.

## Never touch

- `**/.env*` and any credential — floored. (No live secrets live in the repo; the belt stays on.)
- `package-lock.json` — floored; lockfile discipline above.
- `.github/workflows/publish.yml` — floored; the release mechanism (tag → `npm publish`,
  references the `NPM_TOKEN` secret). Publishing is operator-only.
- `scripts/patch-lru-cache-tla.js` — the load-bearing Node-20 lru-cache patch; do not remove
  until upstream fixes.
- The WCAG 2.2 AA guarantees and the `base` theme palette — no change without the contrast
  re-audit above.
- `CHANGELOG.md` release headers and `package.json` version — release hygiene is Chris's.
