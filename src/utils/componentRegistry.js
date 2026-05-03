// Bundled CMS components — discovered at module-eval time via the
// framework's own glob. Site-local components from `site/components/`
// are added separately at runtime via `setSiteComponents()` (called by
// the generated entry from a Vite virtual module — see vite-plugin.js
// VIRTUAL_SITE_COMPONENTS). Site components are checked BEFORE bundled
// components during resolution (most-specific wins), with a console
// warning when a site component shadows a bundled component.

const rawModules = import.meta.glob(['../components/**/*.vue', '!../components/Home.vue'], { eager: true });

function normalizeComponentEntry(entry) {
  return entry && typeof entry === 'object' && 'default' in entry ? entry.default : entry;
}

function resolveComponentName(filePath) {
  const normalized = filePath.replace(/^\.{2}\//, '').replace(/\.vue$/i, '');
  const parts = normalized.split('/');
  return parts.length ? parts[parts.length - 1] : normalized;
}

export function createRegistry(modules) {
  const registry = Object.entries(modules).reduce((acc, [file, module]) => {
    const component = normalizeComponentEntry(module);
    if (!component) return acc;

    const componentName = resolveComponentName(file);

    if (!acc[componentName]) {
      acc[componentName] = component;
    }

    if (componentName.startsWith('Spacer') && componentName.length > 'Spacer'.length) {
      const suffix = componentName.slice('Spacer'.length);
      const parsed = Number.parseInt(suffix, 10);
      const score = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;

      const existing = acc.__spacerFallback;
      if (!existing || score < existing.score) {
        acc.__spacerFallback = { component, score };
      }
    }

    return acc;
  }, {});

  if (!registry.Spacer && registry.__spacerFallback && registry.__spacerFallback.component) {
    registry.Spacer = registry.__spacerFallback.component;
  }
  delete registry.__spacerFallback;

  return registry;
}

export const registry = createRegistry(rawModules);

// ----------------------------------------------------------------------------
// Site-local component registry
//
// Sites can drop Vue files into `site/components/**/*.vue` and reference them
// from `pages/{pageId}.json` `components[]` by name — same as bundled or
// extension components. The vite plugin globs these eagerly into a virtual
// module that the generated entry imports and hands to `setSiteComponents`.
//
// Resolution priority (in useComponentResolver): site → extension → bundled.
// Source-qualified `site:Name` always resolves to the site-local component;
// `slug:Name` continues to target a specific extension.

const siteRegistry = {};
const siteShadows = {};

function buildSiteRegistry(modules) {
  const next = {};
  const collisions = {};
  for (const [file, module] of Object.entries(modules || {})) {
    const component = normalizeComponentEntry(module);
    if (!component) continue;
    const name = resolveComponentName(file);
    if (!name) continue;
    if (next[name]) {
      // Same basename in two different files under site/components/ — keep
      // the first and warn so the user can rename.
      (collisions[name] = collisions[name] || []).push(file);
      continue;
    }
    next[name] = component;
  }
  return { entries: next, duplicates: collisions };
}

/**
 * Register components found under `site/components/`. Called once during app
 * initialization by the generated entry. Also accepts the result of an
 * `import.meta.glob('@cms-site/components/**\/*.vue', { eager: true })` call.
 */
export function setSiteComponents(modules) {
  // Reset prior state so HMR re-registrations don't accumulate stale entries.
  for (const key of Object.keys(siteRegistry)) delete siteRegistry[key];
  for (const key of Object.keys(siteShadows)) delete siteShadows[key];

  const source = modules && typeof modules === 'object'
    ? (modules.default && typeof modules.default === 'object' ? modules.default : modules)
    : {};

  const { entries, duplicates } = buildSiteRegistry(source);
  Object.assign(siteRegistry, entries);

  // Emit a single concise warning per site-component name that:
  //   - shadows a bundled CMS component (overrides are powerful and easy
  //     to do by accident — flag them so they're explicit), or
  //   - has duplicate basenames across subdirectories (only the first
  //     wins; rename or restructure to fix).
  if (typeof console !== 'undefined' && import.meta.env?.DEV) {
    for (const name of Object.keys(entries)) {
      if (registry[name] && registry[name] !== entries[name]) {
        siteShadows[name] = true;
        console.warn(
          `[site-components] "${name}" overrides a bundled CMS component. ` +
          `Use "site:${name}" in pages/*.json to make this explicit, or rename if accidental.`,
        );
      }
    }
    for (const [name, files] of Object.entries(duplicates)) {
      console.warn(
        `[site-components] Multiple files named "${name}.vue" in site/components/; ` +
        `keeping the first registration. Duplicates: ${files.join(', ')}.`,
      );
    }
  }
}

/**
 * Lookup helper used by useComponentResolver. Returns the site-local component
 * for `name` or `undefined`.
 */
export function getSiteComponent(name) {
  if (!name) return undefined;
  return siteRegistry[name];
}

/**
 * Read-only snapshot of the registered site components. Mainly for tests and
 * tooling; runtime resolution should use getSiteComponent.
 */
export function getSiteRegistry() {
  return { ...siteRegistry };
}
