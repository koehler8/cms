/**
 * Build a Web App Manifest (manifest.json) from the inflated site config.
 *
 * Returns the manifest object — the plugin JSON-stringifies and writes it
 * to `siteRoot/public/manifest.json`. Browsers consume the file when the
 * page emits `<link rel="manifest" href="/manifest.json">`.
 *
 * Authoring conventions in `site.json`:
 *
 *   "manifest.name": "...",          // overrides site.title
 *   "manifest.shortName": "...",     // overrides truncated site.title
 *   "manifest.themeColor": "#...",   // mobile chrome / splash bar color
 *   "manifest.backgroundColor": "#...",  // splash background
 *   "manifest.startUrl": "/",        // landing path on launch
 *   "manifest.display": "standalone",// browser, standalone, fullscreen, minimal-ui
 *   "manifest.icons[0].src": "...",  // override default icon set
 *   "manifest.icons[0].sizes": "256x256",
 *   "manifest.icons[0].type": "image/png"
 *
 * Defaults are derived from existing site config and the icons that
 * cms-generate-public-assets writes (favicon-256.png + favicon.ico).
 */

const DEFAULT_DISPLAY = 'standalone';
const DEFAULT_BG = '#ffffff';
const DEFAULT_THEME = '#ffffff';
const DEFAULT_START = '/';

function trim(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  return t || fallback;
}

function defaultIcons() {
  // Mirrors what cms-generate-public-assets writes into public/.
  // Browsers pick the best size; the 256x256 PNG is the primary, the
  // .ico is the legacy fallback for older Android.
  return [
    { src: '/favicon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any maskable' },
    { src: '/favicon.ico', sizes: '64x64 32x32 16x16', type: 'image/x-icon' },
  ];
}

export function buildWebAppManifest(siteConfig) {
  const site = (siteConfig && siteConfig.site) || {};
  const m = (site.manifest && typeof site.manifest === 'object') ? site.manifest : {};

  const siteTitle = trim(site.title);
  const name = trim(m.name, siteTitle) || 'Site';
  const shortName = trim(m.shortName, name.length <= 12 ? name : name.slice(0, 12));

  const description = trim(m.description, trim(site.description));

  const themeColor = trim(m.themeColor, DEFAULT_THEME);
  const backgroundColor = trim(m.backgroundColor, DEFAULT_BG);
  const startUrl = trim(m.startUrl, DEFAULT_START);
  const display = trim(m.display, DEFAULT_DISPLAY);
  const lang = trim(m.lang);

  const customIcons = Array.isArray(m.icons)
    ? m.icons
        .filter((icon) => icon && typeof icon === 'object' && typeof icon.src === 'string')
        .map((icon) => ({ ...icon }))
    : null;
  const icons = customIcons && customIcons.length ? customIcons : defaultIcons();

  const manifest = {
    name,
    short_name: shortName,
    start_url: startUrl,
    display,
    theme_color: themeColor,
    background_color: backgroundColor,
    icons,
  };

  if (description) manifest.description = description;
  if (lang) manifest.lang = lang;

  return manifest;
}
