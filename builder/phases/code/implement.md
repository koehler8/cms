---
mode: extend
---
Vertex CMS implementation constraints (root `CLAUDE.md`).

- **One source of truth per concern.** Change draft logic in `src/utils/draftMode.js`, URL formulas in `src/utils/canonicalUrl.js`, not-found detection in `src/utils/notFound.js`, head emission in `usePageMeta`; never reimplement one of these in a component or the plugin. Keep the singleton initialisation in the generated `.cms-entry.js` intact.
- **Tests in `tests/` mirroring `src/`**, Vitest + happy-dom + `@vue/test-utils`, using `tests/helpers/setup.js` mocks. A behaviour change updates the spec that pinned the old behaviour; a new util or composable gets its own spec.
- **Accessibility holds after the change.** Touching a bundled component or theme: no `outline: none` without a replacement, keep `:focus-visible` and `prefers-reduced-motion`, keep heading order and landmarks, keep the skip link first and the single `<main id="main-content">`, keep `DraftGate`'s dialog semantics; a new text-on-surface colour pair meets 4.5:1 (3:1 large/UI) and reads from the matching surface tokens. If AA needs a structural change you are unsure of, stop and say so rather than merge it.
- **URLs**: never emit a trailing slash; never route or pre-render `/{baseLocale}/path`; sitemap, robots and canonical/hreflang stay in agreement.
- **Dependencies**: `nvm use` first (`npm -v` must report 10.9.x); targeted `npm install <pkg>@<ver>` (`--save` for a runtime dependency, `--save-dev` for a dev one) for exactly the packages the plan names; a peer-dependency range is a hand edit to `package.json`; never `rm package-lock.json`, never `npm update`. After a bump, `git diff package-lock.json` must move only the named packages and their own dependencies, and `node scripts/check-site-lockfile.mjs .` must pass. No new runtime dependency the plan did not name.
- **Do not** bump the version, add a `CHANGELOG.md` entry, tag, or publish — release is a separate step. Do not touch `.github/workflows/publish.yml` or the `files` / `exports` maps unless the plan names them.
- **Self-check before finishing**: `npm test` (the full Vitest suite — the gate `builder/verify.json` runs). Fix anything it flags.
