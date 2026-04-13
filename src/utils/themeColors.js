import { resolveThemeManifest } from '../themes/themeLoader.js';

const toKebab = (value = '') =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();

const HEX_FALLBACK_BY_COLOR = {
  neon_pink: '#ff2d86',
  crimson_red: '#d9164b',
  sultry_purple: '#9a2eff',
  electric_blue: '#27f3ff',
  amber_heat: '#ffaa1d',
  deep_violet: '#5a1b9d',
};

const normalizeKey = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const derivePaletteMap = (manifest) => {
  const map = {};
  const palette = manifest?.tokens?.palette || {};
  Object.entries(palette).forEach(([key, value]) => {
    const kebab = normalizeKey(toKebab(key));
    map[kebab] = value;
  });
  return map;
};

let activeThemeKey = 'base';
let activePalette = derivePaletteMap(resolveThemeManifest(activeThemeKey));

export function setActiveThemeKey(themeKey) {
  const normalized =
    typeof themeKey === 'string' && themeKey.trim() ? themeKey.trim().toLowerCase() : 'base';
  activeThemeKey = normalized;
  activePalette = derivePaletteMap(resolveThemeManifest(activeThemeKey));
}

export function resolveThemeColor(colorKey) {
  if (!colorKey) return null;
  const normalized = normalizeKey(colorKey);
  return (
    activePalette[normalized] ||
    HEX_FALLBACK_BY_COLOR[colorKey.toLowerCase()] ||
    HEX_FALLBACK_BY_COLOR[normalized] ||
    null
  );
}

export function resolveThemePalette(colorKeys = []) {
  if (!Array.isArray(colorKeys)) return [];
  return colorKeys
    .map((key) => resolveThemeColor(key))
    .filter((value) => Boolean(value));
}

export const DEFAULT_THEME_COLOR_ORDER = [
  'neon_pink',
  'sultry_purple',
  'electric_blue',
  'amber_heat',
  'deep_violet',
  'crimson_red',
];
