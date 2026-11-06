---
mode: extend
---
Vertex CMS planning constraints. This repo is the `@koehler8/cms` framework under ~26 live consumer sites; the root `CLAUDE.md` is the rulebook. A framework change ships to every site on its next install, so the plan reasons about the fleet, not one site.

- **Tests mirror `src/`** (`tests/utils/`, `tests/composables/`, `tests/themes/`, `tests/extensions/`, `tests/router/`, `tests/vite-plugin.spec.js`; Vitest + happy-dom + `@vue/test-utils`). The plan names the spec file each change lands in and the existing tests a behaviour change must update.
- **Single sources of truth are not to be duplicated**: draft mode is `src/utils/draftMode.js`, canonical URLs `src/utils/canonicalUrl.js`, not-found detection `src/utils/notFound.js`, per-page head `usePageMeta`, social meta `src/utils/socialMeta.js`. The "Key Files for Common Tasks" table in `CLAUDE.md` says where a task starts; a plan that touches a second copy of any of these is wrong.
- **Accessibility (WCAG 2.2 AA) is a hard requirement.** A plan that touches a bundled component's markup or CSS, a theme palette, `Home.vue`, `templates/index.html` or `DraftGate.vue` names the row of `CLAUDE.md`'s "When you change something, check it" table that applies and how the change keeps it (skip link first, one `<main>`, `:focus-visible`, `prefers-reduced-motion`, contrast ≥ 4.5:1 / 3:1). A fix that needs a structural change is a stop-and-flag, not a plan step.
- **URL hygiene**: no trailing slashes in emitted URLs; base locale unprefixed, non-base locales at `/{locale}/path`, `/{baseLocale}/path` never routes. A plan that changes routing, sitemap, robots or head emission says how those stay true.
- **Dependencies**: `nvm use` (Node 22.23.2 / npm 10.9) before any install; targeted `npm install <pkg>@<ver>` only, never a lockfile regen; `vue` / `vue-router` / `pinia` / `vite` are peers AND dev deps, so `npm update` is off the table. Patch/minor only; a major is a stop-and-flag.
- **Not in scope of a feature change**: a version bump, a `CHANGELOG.md` entry or a tag — those are release steps (`CLAUDE.md` → Publishing). `templates/scaffolds/site/` is the consumer-site scaffold; changes there are scaffold changes and the plan says so.
- **The verify gates** (`builder/verify.json`) are `npm ci --no-audit --no-fund` and `npm test`. Say which spec proves each acceptance criterion.
