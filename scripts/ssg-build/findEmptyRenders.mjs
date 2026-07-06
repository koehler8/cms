import fsp from 'node:fs/promises';
import path from 'node:path';

// Detect a page whose root container never mounted any real markup — just
// Vue's SSR placeholder comment for "nothing rendered here". This is the
// signature of a rare, silent failure in the onServerPrefetch data-fetch
// path: @vue/server-renderer's renderComponentVNode gates a component's
// render on `Promise.all(prefetches).catch(NOOP)` (see server-renderer.cjs.js
// in any consuming site's node_modules) — if that promise ever rejects, the
// renderer swallows the error entirely and renders anyway, using whatever
// default/empty state the component held. No warning, no non-zero exit —
// just well-formed, blank HTML on disk. A real page from this framework is
// never legitimately empty (Home.vue always renders at least the skip-link +
// <main>, DraftGate renders a dialog, 404 renders NotFound), so any match
// here is unconditionally a bug. Kept in its own module (no side effects on
// import) so it's unit-testable without tripping index.mjs's top-level
// main() invocation — see bin/cms-ssg-build.js.
const EMPTY_ROOT_RE = /<div id="[^"]+"[^>]*>\s*<!---->\s*<\/div>/;

export async function findEmptyRenders(dir) {
  const empties = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { recursive: true });
  } catch {
    return empties;
  }
  for (const entry of entries) {
    if (!entry.endsWith('index.html')) continue;
    const full = path.join(dir, entry);
    let html;
    try {
      html = await fsp.readFile(full, 'utf8');
    } catch {
      continue;
    }
    if (EMPTY_ROOT_RE.test(html)) {
      empties.push(full);
    }
  }
  return empties;
}
