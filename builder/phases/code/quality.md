---
mode: extend
---
Vertex CMS review facts. The mechanical checks (`builder/verify.json`: `npm ci`, then the full Vitest suite) have already run — their log is above. This framework sits under ~26 live consumer sites, so a regression ships to all of them on their next install.

- **Duplicated truth is `concerns`**: draft logic outside `src/utils/draftMode.js`, a URL formula outside `src/utils/canonicalUrl.js`, not-found detection outside `src/utils/notFound.js`, head emission outside `usePageMeta`, a second copy of a singleton.
- **Accessibility**: a bundled component, theme, `Home.vue`, `templates/index.html` or `DraftGate.vue` change is checked against the `CLAUDE.md` "When you change something, check it" table — a dropped `:focus-visible`, an `outline: none`, a broken `prefers-reduced-motion`, a second `<main>`, a skip link that is no longer first, a heading skip, a text/background pair under 4.5:1 (3:1 large or UI) is `concerns`, with the file:line.
- **URL hygiene**: an emitted trailing slash, a `/{baseLocale}/path` that routes or pre-renders, or sitemap / robots / canonical / hreflang disagreeing with each other is `concerns`.
- **Lockfile**: a regenerated `package-lock.json`, a `vue` / `vue-router` / `pinia` / `vite` move the spec did not name, a major bump, or an `optionalDependencies` entry gone from the lockfile is `concerns`.
- **Scope**: a version bump, `CHANGELOG.md` entry, tag, workflow or `files` / `exports` edit inside a feature change is drift unless the spec named it; so is a change under `templates/scaffolds/site/` the spec did not call for.
- **Tests**: a behaviour change with no spec change, or a spec weakened to pass, is `concerns`.

End with exactly one line: `VERDICT: pass` or `VERDICT: concerns — <why>`.
