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

  // If the theme package shipped inline CSS, inject it into the document head.
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
