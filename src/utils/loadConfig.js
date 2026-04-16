import { inflateFlatConfig } from './inflateFlatConfig.js';
import { unwrapDefault } from './unwrapDefault.js';

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

        if (!locale && typeof localStorage !== 'undefined') {
            try {
                locale = normalizeLocaleInput(localStorage.getItem('locale')) || undefined;
            } catch {
                locale = undefined;
            }
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

export function setConfigLoader(instance) {
  if (!instance) return;
  _loadConfigData = instance.loadConfigData;
  _availableLocales = instance.availableLocales || [];
}

export { _availableLocales as availableLocales };

export const loadConfigData = (...args) => _loadConfigData(...args);
