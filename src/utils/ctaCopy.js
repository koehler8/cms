const camelToKebab = (value) =>
  value.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b.toLowerCase()}`).toLowerCase();

const kebabToCamel = (value) =>
  value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function normalizeKey(type) {
  if (!type) return '';
  if (type.includes('-')) return type.toLowerCase();
  const kebab = camelToKebab(type);
  return kebab;
}

function getVariantConfig(siteData) {
  if (!siteData || typeof siteData !== 'object') return null;
  const root = siteData.site || siteData;
  if (!root || typeof root !== 'object') return null;
  const config = root.ctaCopy;
  if (!config || typeof config !== 'object') return null;
  return config;
}

function pickLabel(variant, key) {
  if (!variant || typeof variant !== 'object') return '';
  const kebabKey = normalizeKey(key);
  const camelKey = kebabToCamel(kebabKey);
  const direct = variant[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const camel = variant[camelKey];
  if (typeof camel === 'string' && camel.trim()) return camel.trim();
  const kebab = variant[kebabKey];
  if (typeof kebab === 'string' && kebab.trim()) return kebab.trim();
  return '';
}

export function resolveCtaCopy(siteDataRef, type, fallback) {
  const rawSite = siteDataRef && typeof siteDataRef === 'object' && 'value' in siteDataRef
    ? siteDataRef.value
    : siteDataRef;

  const config = getVariantConfig(rawSite);
  if (!config) return fallback;

  const { variants = {}, activeVariant, fallbackVariant } = config;

  const normalizedActive = typeof activeVariant === 'string' ? activeVariant.trim().toLowerCase() : '';
  const normalizedFallback = typeof fallbackVariant === 'string' ? fallbackVariant.trim().toLowerCase() : '';

  const variant =
    variants[normalizedActive] ||
    variants[normalizedFallback] ||
    variants.default ||
    null;

  const label = pickLabel(variant, type) || pickLabel(variants.default, type);

  return label || fallback;
}
