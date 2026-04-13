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

    // Find the site.json path and derive the config prefix (everything up to
    // and including `/config/`) so subsequent lookups are scoped correctly.
    function findSiteConfigPrefix() {
        const keys = Object.keys(allModules);
        const siteJsonKeys = keys.filter((key) => key.endsWith('/config/site.json'));
        if (siteJsonKeys.length === 1) {
            const key = siteJsonKeys[0];
            return key.slice(0, key.length - 'site.json'.length);
        }
        return null;
    }

    async function assembleBaseConfig() {
        const prefix = findSiteConfigPrefix();
        if (!prefix) return null;

        const siteLoader = allModules[`${prefix}site.json`];
        if (!siteLoader) return null;

        const sharedLoader = allModules[`${prefix}shared.json`];
        const [siteData, sharedData] = await Promise.all([
            siteLoader().then(toPlain),
            sharedLoader ? sharedLoader().then(toPlain) : Promise.resolve({}),
        ]);

        // Collect only the pages that belong to this site's config directory
        const pagePrefix = `${prefix}pages/`;
        const pages = {};
        const pageLoads = [];
        for (const [path, loader] of Object.entries(allModules)) {
            if (path.startsWith(pagePrefix) && path.endsWith('.json')) {
                const pageId = path.slice(pagePrefix.length, -5);
                pageLoads.push(loader().then((mod) => { pages[pageId] = toPlain(mod); }));
            }
        }
        await Promise.all(pageLoads);

        return { site: siteData, shared: sharedData, pages, _configPrefix: prefix };
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
            delete config._configPrefix;
            return config;
        }

        const baseConfig = await getBaseConfig();

        let mergedConfig = baseConfig;
        // Find locale override scoped to the same config directory as the site
        const configPrefix = baseConfig._configPrefix;
        const localizedLoader = configPrefix
            ? allModules[`${configPrefix}i18n/${normalizedLocale}.json`]
            : undefined;
        if (localizedLoader) {
            const rawLocalized = toPlain(await localizedLoader());
            const localizedConfig = inflateFlatConfig(rawLocalized);
            mergedConfig = mergeConfigTrees(baseConfig, localizedConfig, { cloneTarget: true, skipEmpty: true });
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
        delete mergedConfig._configPrefix;
        return mergedConfig;
    }

    return { loadConfigData, mergeConfigTrees, cloneConfig };
}

// ---- Runtime singleton ----
// Components/composables import `loadConfigData` directly. The Vite plugin's
// generated entry calls `setConfigLoader()` with the configured instance at
// startup.

let _loadConfigData = async () => {
  throw new Error('[@koehler8/cms] loadConfigData() called before config loader was initialized');
};

export function setConfigLoader(instance) {
  if (!instance) return;
  _loadConfigData = instance.loadConfigData;
}

export const loadConfigData = (...args) => _loadConfigData(...args);
