/**
 * Normalize a module key from import.meta.glob into a lookup-friendly format.
 *
 * Strips everything up to and including the 'assets/' segment, producing a
 * relative path like 'img/foo.png'.
 */
function normalizeAssetKey(key = '') {
  const assetsIdx = key.indexOf('assets/');
  if (assetsIdx !== -1) {
    return key.slice(assetsIdx + 'assets/'.length);
  }
  // Fallback for prefixed patterns like @cms-assets/
  const lastSlash = key.lastIndexOf('/');
  return lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
}

export function createAssetResolver(sharedAssetModules, siteAssetModules) {
  const assetUrlMap = {};

  // Register shared (framework) assets
  for (const [key, url] of Object.entries(sharedAssetModules)) {
    const normalizedKey = normalizeAssetKey(key);
    if (normalizedKey) {
      assetUrlMap[normalizedKey] = url;
    }
  }

  // Register site assets
  for (const [key, url] of Object.entries(siteAssetModules)) {
    const normalizedKey = normalizeAssetKey(key);
    if (normalizedKey) {
      assetUrlMap[normalizedKey] = url;
    }
  }

  function resolveAssetUrl(path = '') {
    if (!path || typeof path !== 'string') {
      return '';
    }
    const normalizedPath = path.replace(/^\/+/, '');
    return assetUrlMap[normalizedPath] || '';
  }

  function resolveAsset(relativePath = '', options = {}) {
    if (!relativePath || typeof relativePath !== 'string') {
      return '';
    }

    const normalizedPath = relativePath.replace(/^\/+/, '');
    const extraCandidates = Array.isArray(options.fallbacks) ? options.fallbacks : [];
    const candidates = new Set();

    const addCandidate = (value) => {
      if (!value || typeof value !== 'string') return;
      const candidate = value.replace(/^\/+/, '');
      if (candidate) {
        candidates.add(candidate);
      }
    };

    const withoutLeadingImg = normalizedPath.startsWith('img/')
      ? normalizedPath.slice(4)
      : normalizedPath;

    if (!normalizedPath.startsWith('img/')) {
      addCandidate(`img/${normalizedPath}`);
    }
    if (withoutLeadingImg !== normalizedPath) {
      addCandidate(`img/${withoutLeadingImg}`);
    }

    addCandidate(normalizedPath);
    if (withoutLeadingImg !== normalizedPath) {
      addCandidate(withoutLeadingImg);
    }

    extraCandidates.forEach((candidate) => {
      addCandidate(candidate);
    });

    for (const candidate of candidates) {
      if (assetUrlMap[candidate]) {
        return assetUrlMap[candidate];
      }
    }

    return '';
  }

  function resolveMedia(src = '') {
    const value = typeof src === 'string' ? src.trim() : '';
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('/')) {
      return value;
    }

    const normalized = value.replace(/^\/+/, '');
    const segments = normalized.split('/');

    const mediaCandidates = [normalized];
    if (segments.length > 1) {
      const [, ...restSegments] = segments;
      if (restSegments.length) {
        mediaCandidates.push(restSegments.join('/'));
      }
    }
    mediaCandidates.push(`img/${normalized}`);
    mediaCandidates.push(`logos/${normalized}`);

    const uniqueCandidates = Array.from(new Set(mediaCandidates));
    for (const candidate of uniqueCandidates) {
      const resolved = resolveAsset(candidate);
      if (resolved) {
        return resolved;
      }
    }

    return value;
  }

  return { resolveAssetUrl, resolveAsset, resolveMedia, assetUrlMap };
}

// ---- Runtime singleton ----
// Components import resolver functions directly from this module. The Vite
// plugin's generated entry file calls `setAssetResolver()` with the configured
// instance (built from the virtual module's globs) at startup, before any
// component code runs.

const emptyWarning = (name) => () => {
  if (typeof console !== 'undefined') {
    console.warn(`[@koehler8/cms] ${name}() called before asset resolver was initialized`);
  }
  return '';
};

let _resolveAssetUrl = emptyWarning('resolveAssetUrl');
let _resolveAsset = emptyWarning('resolveAsset');
let _resolveMedia = emptyWarning('resolveMedia');
let _assetUrlMap = {};

export function setAssetResolver(instance) {
  if (!instance) return;
  _resolveAssetUrl = instance.resolveAssetUrl;
  _resolveAsset = instance.resolveAsset;
  _resolveMedia = instance.resolveMedia;
  _assetUrlMap = instance.assetUrlMap || {};
}

export const resolveAssetUrl = (...args) => _resolveAssetUrl(...args);
export const resolveAsset = (...args) => _resolveAsset(...args);
export const resolveMedia = (src) => _resolveMedia(src);
export const assetUrlMap = new Proxy({}, {
  get: (_, key) => _assetUrlMap[key],
  has: (_, key) => key in _assetUrlMap,
  ownKeys: () => Object.keys(_assetUrlMap),
  getOwnPropertyDescriptor: (_, key) => {
    if (key in _assetUrlMap) {
      return { value: _assetUrlMap[key], enumerable: true, configurable: true };
    }
  },
});
