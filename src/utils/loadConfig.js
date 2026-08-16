import { inflateFlatConfig } from './inflateFlatConfig.js';
import { unwrapDefault } from './unwrapDefault.js';
import { readStoredLocale } from './webStorage.js';

function normalizeLocaleInput(value) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const candidate = normalizeLocaleInput(entry);
            if (candidate) {
                return candidate;
            }
        }
        return undefined;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}

export function cloneConfig(value) {
    if (Array.isArray(value)) {
        return value.map(cloneConfig);
    }
    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((acc, [key, val]) => {
            acc[key] = cloneConfig(val);
            return acc;
        }, {});
    }
    return value;
}

// Reduce a resolved config's `pages` map to a single page, preserving `site`
// and `shared` (which every page needs globally). Used by the SSG pass when a
// site opts into `site.trimInitialState` so each pre-rendered page embeds only
// its own page config in `window.__INITIAL_STATE__` instead of the entire
// site's pages (which is byte-identical on every page and can dominate the
// page weight). Marks the result `pagesPartial: true` so the client knows the
// embedded config can't resolve other pages and must lazy-load the full config
// before in-SPA navigation (see usePageConfig.hydrateFromSyncCache). Returns
// the config untouched when the page id is absent — a safe no-op fallback so a
// mis-resolved route never trims away the page actually being rendered.
export function trimConfigToPage(config, pageId) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
    if (!config.pages || typeof config.pages !== 'object') return config;
    if (!pageId || !Object.prototype.hasOwnProperty.call(config.pages, pageId)) return config;
    return { ...config, pages: { [pageId]: config.pages[pageId] }, pagesPartial: true };
}

// Map a route being pre-rendered to its page id, for the SSG trim above.
// Strips a leading `/{locale}` segment (non-base locales render at
// `/{locale}/path`), normalizes trailing/duplicate slashes, and matches against
// each page's `path` (defaulting a path-less page to '/'). Returns the id only
// on an UNAMBIGUOUS single match — home, path-less, or colliding routes return
// null so the caller keeps the full config (a safe no-op). Pure/exported so the
// locale-strip + matching rules are unit-testable without a full SSG build.
export function resolvePageIdForRoute(config, routePath, localeParam) {
    if (typeof routePath !== 'string' || !routePath) return null;
    let target = routePath;
    if (localeParam && typeof localeParam === 'string') {
        const prefix = `/${localeParam}`;
        if (target === prefix) target = '/';
        else if (target.startsWith(`${prefix}/`)) target = target.slice(prefix.length);
    }
    const normalize = (p) =>
        (typeof p === 'string' ? p : '/').replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
    target = normalize(target);
    const pages = (config && config.pages) || {};

    // The SSG pre-renders `/404` from a site's custom `pages/404.json` (mirrors
    // usePageConfig.selectPage's `/404` → `404` mapping). That page is
    // conventionally path-less, so it can't be matched by `path` below — map the
    // route to it directly. It is also deliberately NOT treated as living at `/`
    // (see the id === '404' guard in the matcher) so it never collides with
    // `home` there — the collision that otherwise makes `/` ambiguous on any
    // site shipping a custom 404 page, suppressing the home-page trim.
    const notFound = pages['404'];
    const notFoundPathless = notFound && !(typeof notFound.path === 'string' && notFound.path.trim());
    if (target === '/404' && notFoundPathless) return '404';

    const matches = Object.entries(pages).filter(([id, data]) => {
        const hasPath = data && typeof data.path === 'string' && data.path.trim();
        // A page with no explicit `path` conventionally lives at `/` (home). The
        // SSG-only `404` page is the exception: it is served at `/404`, never `/`.
        const pagePath = hasPath ? data.path : (id === '404' ? null : '/');
        if (pagePath === null) return false;
        return normalize(pagePath) === target;
    });
    return matches.length === 1 ? matches[0][0] : null;
}

export function mergeConfigTrees(target, source, options = {}) {
    const { cloneTarget = false, skipEmpty = true } = options;

    const result =
        cloneTarget && target && typeof target === 'object'
            ? cloneConfig(target)
            : Array.isArray(target)
                ? [...(target || [])]
                : target && typeof target === 'object'
                    ? { ...(target || {}) }
                    : target;

    const isEmptyish = (value) => {
        if (!skipEmpty) return false;
        if (value === undefined || value === null) return true;
        if (typeof value === 'string' && value.trim() === '') return true;
        if (Array.isArray(value) && value.length === 0) return true;
        if (typeof value === 'object' && Object.keys(value).length === 0) return true;
        return false;
    };

    if (Array.isArray(result) && Array.isArray(source)) {
        const maxLength = Math.max(result.length, source.length);
        const output = new Array(maxLength);

        for (let i = 0; i < maxLength; i++) {
            const baseVal = result[i];
            const srcVal = source[i];

            if (srcVal === undefined || isEmptyish(srcVal)) {
                output[i] = cloneConfig(baseVal);
                continue;
            }

            if (baseVal === undefined) {
                output[i] = cloneConfig(srcVal);
                continue;
            }

            if (Array.isArray(baseVal) && Array.isArray(srcVal)) {
                output[i] = mergeConfigTrees(baseVal, srcVal, { cloneTarget: false, skipEmpty });
                continue;
            }

            if (
                baseVal &&
                srcVal &&
                typeof baseVal === 'object' &&
                typeof srcVal === 'object' &&
                !Array.isArray(baseVal) &&
                !Array.isArray(srcVal)
            ) {
                output[i] = mergeConfigTrees(baseVal, srcVal, { cloneTarget: false, skipEmpty });
                continue;
            }

            output[i] = cloneConfig(srcVal);
        }

        return output;
    }

    if (Array.isArray(source) && !Array.isArray(result)) {
        return skipEmpty && isEmptyish(source) ? result : [...source];
    }

    if (source && typeof source === 'object') {
        const base = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
        const output = cloneTarget ? cloneConfig(base) : { ...base };

        for (const [key, value] of Object.entries(source)) {
            if (isEmptyish(value)) continue;

            const existing = output[key];
            if (Array.isArray(existing) && Array.isArray(value)) {
                output[key] = mergeConfigTrees(existing, value, { cloneTarget: false, skipEmpty });
            } else if (
                existing &&
                value &&
                typeof existing === 'object' &&
                typeof value === 'object' &&
                !Array.isArray(existing) &&
                !Array.isArray(value)
            ) {
                output[key] = mergeConfigTrees(existing, value, { cloneTarget: false, skipEmpty });
            } else {
                output[key] = Array.isArray(value) ? [...value] : cloneConfig(value);
            }
        }

        return output;
    }

    return source;
}

export function createConfigLoader(allModules) {
    const toPlain = unwrapDefault;

    // Discover which locale directories exist in the content folder by
    // extracting unique locale codes from the allModules glob keys.
    function discoverAvailableLocales() {
        const locales = new Set();
        const re = /\/content\/([a-z]{2,3}(?:-[a-zA-Z]{2,4})?)\//;
        for (const key of Object.keys(allModules)) {
            const match = key.match(re);
            if (match) locales.add(match[1].toLowerCase());
        }
        return Array.from(locales).sort();
    }

    const availableLocales = discoverAvailableLocales();

    // Find the content root (path ending in `/content/`) and resolve the base
    // locale from content.config.json.
    function findContentRoot() {
        const keys = Object.keys(allModules);
        const configKey = keys.find((key) => key.endsWith('/content/content.config.json'));
        if (configKey) {
            return configKey.slice(0, configKey.length - 'content.config.json'.length);
        }
        return null;
    }

    async function resolveBaseLocale(contentRoot) {
        const configLoader = allModules[`${contentRoot}content.config.json`];
        if (!configLoader) return 'en';
        const config = toPlain(await configLoader());
        return (config && config.baseLocale) || 'en';
    }

    // Assemble a config from a locale directory: inflates flat-format files
    // (site.json, shared.json, pages/*.json) and returns { site, shared, pages }.
    // When require is true, returns null if site.json is missing (used for
    // base config). When false, assembles whatever files exist (used for
    // locale overrides that may only contain partial translations).
    async function assembleSplitConfig(localePrefix, { require: requireSite = false } = {}) {
        const siteLoader = allModules[`${localePrefix}site.json`];
        if (!siteLoader && requireSite) return null;

        const sharedLoader = allModules[`${localePrefix}shared.json`];
        const [rawSite, rawShared] = await Promise.all([
            siteLoader ? siteLoader().then(toPlain) : Promise.resolve({}),
            sharedLoader ? sharedLoader().then(toPlain) : Promise.resolve({}),
        ]);
        const siteData = inflateFlatConfig(rawSite);
        const sharedData = inflateFlatConfig(rawShared);

        const pagePrefix = `${localePrefix}pages/`;
        const pages = {};
        const pageLoads = [];
        for (const [path, loader] of Object.entries(allModules)) {
            if (path.startsWith(pagePrefix) && path.endsWith('.json')) {
                const pageId = path.slice(pagePrefix.length, -5);
                pageLoads.push(
                    loader().then((mod) => { pages[pageId] = inflateFlatConfig(toPlain(mod)); })
                );
            }
        }
        await Promise.all(pageLoads);

        // Return null if no files were found at all for this locale
        if (!siteLoader && !sharedLoader && Object.keys(pages).length === 0) return null;

        return { site: siteData, shared: sharedData, pages };
    }

    async function assembleBaseConfig() {
        const contentRoot = findContentRoot();
        if (!contentRoot) return null;

        const baseLocale = await resolveBaseLocale(contentRoot);
        const basePrefix = `${contentRoot}${baseLocale}/`;
        const config = await assembleSplitConfig(basePrefix, { require: true });
        if (!config) return null;

        return { ...config, _contentRoot: contentRoot, _baseLocale: baseLocale };
    }

    async function loadConfigData(options) {
        let explicitLocale;

        if (typeof options === 'string' || Array.isArray(options)) {
            explicitLocale = normalizeLocaleInput(options);
        } else if (options && typeof options === 'object') {
            explicitLocale = normalizeLocaleInput(options.locale);
        }

        let locale = explicitLocale;

        if (!locale) {
            locale = normalizeLocaleInput(readStoredLocale()) || undefined;
        }

        const normalizedLocale = typeof locale === 'string' ? locale.toLowerCase() : undefined;

        const getBaseConfig = async () => {
            const assembled = await assembleBaseConfig();
            if (assembled) return assembled;
            throw new Error('Config file not found');
        };

        if (normalizedLocale === undefined) {
            const config = await getBaseConfig();
            delete config._contentRoot;
            delete config._baseLocale;
            return config;
        }

        const baseConfig = await getBaseConfig();

        let mergedConfig = baseConfig;
        const contentRoot = baseConfig._contentRoot;
        const baseLocale = baseConfig._baseLocale;

        // Only load locale overrides if the requested locale differs from the base
        if (contentRoot && normalizedLocale !== baseLocale) {
            const localePrefix = `${contentRoot}${normalizedLocale}/`;
            const localeConfig = await assembleSplitConfig(localePrefix);
            if (localeConfig) {
                mergedConfig = mergeConfigTrees(baseConfig, localeConfig, { cloneTarget: true, skipEmpty: true });
            }
        }
        if (mergedConfig && mergedConfig.pages && typeof mergedConfig.pages === 'object') {
            for (const page of Object.values(mergedConfig.pages)) {
                if (!page || typeof page !== 'object') continue;
                if (!Array.isArray(page.components)) {
                    page.components = [];
                    continue;
                }
                page.components = page.components.map((entry) => {
                    if (!entry || typeof entry !== 'object') {
                        return entry;
                    }
                    const normalized = { ...entry };
                    if (typeof normalized.enabled !== 'boolean') {
                        normalized.enabled = true;
                    }
                    if (normalized.name && typeof normalized.name === 'string') {
                        normalized.name = normalized.name.trim();
                    }
                    if (normalized.source && typeof normalized.source === 'string') {
                        normalized.source = normalized.source.trim();
                    }
                    if (normalized.configKey && typeof normalized.configKey === 'string') {
                        normalized.configKey = normalized.configKey.trim();
                    }
                    return normalized;
                });
            }
        }
        delete mergedConfig._contentRoot;
        delete mergedConfig._baseLocale;
        return mergedConfig;
    }

    return { loadConfigData, mergeConfigTrees, cloneConfig, availableLocales };
}

// ---- Runtime singleton ----
// Components/composables import `loadConfigData` directly. The Vite plugin's
// generated entry calls `setConfigLoader()` with the configured instance at
// startup.

let _loadConfigData = async () => {
  throw new Error('[@koehler8/cms] loadConfigData() called before config loader was initialized');
};

let _availableLocales = [];
let _baseLocale = '';
let _imageVariantWidths = [];

// Synchronous, client-side cache of the config the SSR/SSG pass already
// resolved. Warmed once before mount (see main.js, from the vite-ssg-
// serialized `initialState.siteConfig`) so the first client render can
// populate synchronously and match the prerendered DOM — eliminating the
// paint -> blank -> paint flash caused by config arriving asynchronously via
// lazy dynamic-import chunks. Keyed by normalized locale; SSR never reads it.
const _syncConfigCache = new Map();

function normalizeConfigCacheKey(locale) {
  if (typeof locale === 'string') {
    const trimmed = locale.trim().toLowerCase();
    if (trimmed) return trimmed;
  }
  return 'default';
}

export function setConfigLoader(instance) {
  if (!instance) return;
  _loadConfigData = instance.loadConfigData;
  _availableLocales = instance.availableLocales || [];
  _baseLocale = typeof instance.baseLocale === 'string' ? instance.baseLocale : '';
  _imageVariantWidths = Array.isArray(instance.imageVariantWidths) ? instance.imageVariantWidths : [];
  _syncConfigCache.clear();
}

// Store a resolved config for synchronous retrieval during the first client
// render. Pass the config exactly as the server resolved it (e.g. the
// serialized `initialState.siteConfig`) so `peekConfigSync` returns a value
// that matches the prerendered DOM.
export function primeConfigSync(locale, config) {
  if (!config || typeof config !== 'object') return;
  _syncConfigCache.set(normalizeConfigCacheKey(locale), config);
}

// Retrieve a primed config synchronously, or null on a miss. Client-only fast
// path used by usePageConfig; a miss falls back to the async loader.
export function peekConfigSync(locale) {
  return _syncConfigCache.get(normalizeConfigCacheKey(locale)) || null;
}

export { _availableLocales as availableLocales };
export { _baseLocale as baseLocale };

// The resolved image-variant width matrix from the build (site.imageVariants
// .widths or the pipeline default). useResponsiveImage defaults to this so
// srcsets only ever reference widths the pipeline actually generates.
export function getImageVariantWidths() {
  return _imageVariantWidths;
}

export const loadConfigData = (...args) => _loadConfigData(...args);
