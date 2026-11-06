---
mode: extend
---
This repo's harness is **Vitest** (`npm test` → `vitest run`) with the happy-dom environment and `@vue/test-utils`; global mocks live in `tests/helpers/setup.js` (IntersectionObserver, requestIdleCallback) and `tests/helpers/package-json-raw.js`. `tests/` mirrors `src/`: `tests/components/`, `tests/utils/`, `tests/composables/`, `tests/themes/`, `tests/extensions/`, `tests/router/`, plus `tests/vite-plugin.spec.js` for plugin helpers and `tests/scripts/` for build scripts.

1. Put the spec in the directory that mirrors the module, in the existing file when one covers it, matching its `describe` / `it` style and fixtures. Components are tested with `@vue/test-utils` `mount` under happy-dom; utils and composables as plain functions.
2. A spec for a behaviour change fails on the current code — run `npx vitest run <file>` and show the failure. Accessibility properties the spec names (a `:focus-visible` rule, a landmark, an `aria-*` attribute, a dialog's focus move) are asserted on rendered markup, not described.
3. Never touch `src/`, `themes/`, `templates/` or the lockfile at this stage; never add a dependency.
4. The verify gates (`builder/verify.json`) are `npm ci --no-audit --no-fund` and `npm test` — name them, and the targeted `npx vitest run <file>`, in the mechanical half of the acceptance checklist.
