import baseManifest from '../../themes/base/theme.config.js';
const cssModules = import.meta.glob('../../themes/**/theme.css', { eager: true });
import { validateThemeManifest } from './themeValidator.js';

const manifestModules = import.meta.glob(
  [
    '../../themes/**/theme.config.js',
    '../../themes/**/theme.config.mjs',
    '../../themes/**/theme.config.json',
  ],
  { eager: true }
);

const catalog = {};

const normalizeSlug = (slug) =>
  typeof slug === 'string' && slug.trim().length > 0 ? slug.trim().toLowerCase() : null;

const cssMap = Object.keys(cssModules).reduce((acc, key) => {
  const slugMatch = key.match(/\/themes\/([^/]+)\/theme\.css$/);
  if (slugMatch) {
    acc[slugMatch[1]] = key;
  }
  return acc;
}, {});

const addToCatalog = (manifest, sourceId, cssPath) => {
  if (!manifest || typeof manifest !== 'object') return;
  const normalized = normalizeSlug(manifest.slug);
  try {
    validateThemeManifest(manifest);
  } catch (error) {
    const message = error?.message || 'Unknown theme validation error';
    throw new Error(`[theme-loader] ${message} (source: ${sourceId})`);
  }
  if (!normalized) {
    throw new Error(`[theme-loader] Theme manifest missing slug (source: ${sourceId})`);
  }
  if (catalog[normalized]) {
    console.warn(
      `[theme-loader] Duplicate theme slug "${normalized}" detected. Source ${sourceId} skipped.`
    );
    return;
  }

  catalog[normalized] = {
    ...manifest,
    slug: normalized,
    assets: {
      ...manifest.assets,
      css: manifest.assets?.css || cssPath || undefined,
    },
  };
};

// Auto-discover bundled themes (i.e. base)
Object.entries(manifestModules).forEach(([path, module]) => {
  const manifest = module?.default ?? module;
  const slug = normalizeSlug(manifest?.slug);
  const bundledCssPath = slug ? cssMap[slug] : undefined;
  addToCatalog(manifest, path, bundledCssPath ? bundledCssPath.replace('../../', '') : undefined);
});

if (!catalog.base) {
  addToCatalog(baseManifest, 'themes/base/theme.config.js', undefined);
}

/**
 * Register an external theme package.
 *
 * Called by the Vite plugin for each theme passed via the `themes` option.
 * Must be called before the first render (during app initialisation).
 *
 * Two patterns for shipping theme CSS:
 *
 *   1. **Side-effect import (preferred).** The theme's `index.js` imports
 *      its `theme.css` for side effects:
 *
 *        import manifest from './theme.config.js';
 *        import './theme.css';
 *        export default { manifest };
 *
 *      Vite bundles `theme.css` into the main entry chunk and emits a
 *      synchronous `<link rel="stylesheet">` in `<head>`, so theme rules
 *      apply during the initial paint. Combined with the SSR-rendered
 *      `data-site-theme` attribute (set in `applySiteTheme`), this
 *      eliminates the FOUC that JS-injected theme CSS used to cause.
 *
 *   2. **Inline string (legacy).** The theme's `index.js` imports the CSS
 *      with `?inline` and exports it as a `css` string:
 *
 *        import manifest from './theme.config.js';
 *        import css from './theme.css?inline';
 *        export default { manifest, css };
 *
 *      The CSS is injected via a runtime `<style>` tag (handled below).
 *      This works but applies after Vue hydrates, so dark themes will
 *      flash a light first paint unless the site provides critical CSS.
 *
 * Existing themes (cms-theme-neon, -frog, -aurora, -southpark, -swamp)
 * still use pattern 2 and are supported indefinitely; new themes should
 * prefer pattern 1.
 *
 * @param {object} themeModule - Default export from a @koehler8/cms-theme-* package
 *   Expected shape: { manifest, css? } or just the manifest object directly.
 */
export function registerTheme(themeModule) {
  if (!themeModule || typeof themeModule !== 'object') {
    throw new Error('[theme-loader] registerTheme() requires a theme module object');
  }

  const manifest = themeModule.manifest || themeModule;
  const cssContent = themeModule.css;
  const sourceId = `external:${manifest?.slug || 'unknown'}`;

  addToCatalog(manifest, sourceId, undefined);

  // Legacy pattern 2: theme shipped inline CSS, inject it into the document head.
  // For pattern 1 themes, `cssContent` is undefined and this block is skipped —
  // the CSS is already loaded via Vite's bundling.
  if (cssContent && typeof cssContent === 'string' && typeof document !== 'undefined') {
    const slug = normalizeSlug(manifest.slug);
    const existingStyle = document.getElementById(`theme-css-${slug}`);
    if (!existingStyle) {
      const style = document.createElement('style');
      style.id = `theme-css-${slug}`;
      style.textContent = cssContent;
      document.head.appendChild(style);
    }
  }
}

export function getThemeCatalog() {
  return catalog;
}

export function getThemeManifest(themeKey) {
  if (typeof themeKey !== 'string') return null;
  return catalog[themeKey.trim().toLowerCase()] || null;
}

export function resolveThemeManifest(themeKey) {
  return (
    getThemeManifest(themeKey) ||
    catalog.base ||
    Object.values(catalog)[0] ||
    null
  );
}

export function listThemeMetadata() {
  return Object.values(catalog).map((manifest) => ({
    slug: manifest.slug,
    meta: manifest.meta,
  }));
}
