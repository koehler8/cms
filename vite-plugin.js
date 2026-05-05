/**
 * @koehler8/cms Vite plugin
 *
 * Generates virtual modules that wire site-specific content (config, assets,
 * styles) into the CMS framework. Site repos consume this via a 3-line
 * vite.config.js and otherwise contain only content.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vue from '@vitejs/plugin-vue';

import { inflateFlatConfig } from './src/utils/inflateFlatConfig.js';
import { buildRobotsTxt } from './src/utils/robotsGenerator.js';
import { buildSitemap, getSitemapUrl } from './src/utils/sitemapGenerator.js';
import { buildWebAppManifest } from './src/utils/webAppManifest.js';
import { sha256Hex } from './src/utils/sha256.js';

// ---- Helpers ----

function loadSplitConfig(contentLocaleDir) {
  const sitePath = path.join(contentLocaleDir, 'site.json');
  if (!fs.existsSync(sitePath)) return null;

  const site = inflateFlatConfig(JSON.parse(fs.readFileSync(sitePath, 'utf-8')));
  // The plaintext password is read at build time so the plugin can produce
  // robots.txt / sitemap.xml without surfacing it; strip it out of the
  // in-memory siteConfig so accidental future code paths can't pass it
  // through to the bundle. The `transform` hook below replaces the
  // plaintext with a SHA-256 hash before any JSON file is imported by the
  // runtime.
  if (site && typeof site === 'object') {
    delete site.draftPassword;
  }
  const sharedPath = path.join(contentLocaleDir, 'shared.json');
  const shared = fs.existsSync(sharedPath) ? inflateFlatConfig(JSON.parse(fs.readFileSync(sharedPath, 'utf-8'))) : {};

  const pagesDir = path.join(contentLocaleDir, 'pages');
  const pages = {};
  if (fs.existsSync(pagesDir)) {
    for (const file of fs.readdirSync(pagesDir)) {
      if (!file.endsWith('.json')) continue;
      const pageId = file.replace('.json', '');
      pages[pageId] = inflateFlatConfig(JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf-8')));
    }
  }

  return { site, shared, pages };
}

// Replace site.json's plaintext draftPassword with a SHA-256 hash before
// the JSON ever enters the bundle. Returns the original code untouched
// when the file doesn't carry a password (or doesn't parse as JSON), so
// non-CMS site.json files anywhere else in the project are unaffected.
async function transformSiteJson(code) {
  let parsed;
  try {
    parsed = JSON.parse(code);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const password = typeof parsed.draftPassword === 'string' ? parsed.draftPassword.trim() : '';
  if (!('draftPassword' in parsed) && !password) return null;

  delete parsed.draftPassword;
  if (password) {
    parsed.draftPasswordHash = await sha256Hex(password);
  }
  return JSON.stringify(parsed);
}

function normalizeRoutePath(value = '/') {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/+/g, '/');
  normalized = normalized.replace(/\/$/, '');
  return normalized || '/';
}

function collectPagePaths(config) {
  if (!config || typeof config !== 'object') return ['/'];
  const pages = config.pages || {};
  const paths = new Set(['/']);
  Object.values(pages).forEach((page) => {
    if (!page || typeof page !== 'object') return;
    if ('path' in page) {
      paths.add(normalizeRoutePath(page.path));
    }
  });
  return Array.from(paths);
}

function collectExtensionSetupFiles(extensionsDir) {
  if (!fs.existsSync(extensionsDir)) return [];
  const setupNames = ['vitest.setup.js', 'vitest.setup.ts', 'setup.js', 'setup.ts'];
  const setups = [];
  for (const slug of fs.readdirSync(extensionsDir)) {
    const testDir = path.join(extensionsDir, slug, 'tests');
    if (!fs.existsSync(testDir)) continue;
    setupNames.forEach((filename) => {
      const fullPath = path.join(testDir, filename);
      if (fs.existsSync(fullPath)) setups.push(fullPath);
    });
  }
  return setups;
}

function extractSiteMetadata(siteConfig) {
  const {
    title: siteTitle = '',
    description: siteDescription = '',
    url: siteUrl = '',
    googleId: siteGoogleId = '',
    sameAs: siteSameAs = [],
    manifest: siteManifest = {},
  } = siteConfig.site || {};

  const siteSameAsList = Array.isArray(siteSameAs)
    ? siteSameAs.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  const siteSameAsJson = JSON.stringify(siteSameAsList);

  // Mobile chrome bar / PWA splash color. Defaults match buildWebAppManifest's
  // default so the rendered <meta name="theme-color"> matches whatever
  // manifest.json advertises.
  const manifestThemeColor = (typeof siteManifest.themeColor === 'string'
    ? siteManifest.themeColor.trim()
    : '') || '#ffffff';

  return { siteTitle, siteDescription, siteUrl, siteGoogleId, siteSameAsJson, manifestThemeColor };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Virtual module IDs (config, styles, assets — the entry is a real file on disk)
const VIRTUAL_CONFIG = 'virtual:cms-config-loader';
const VIRTUAL_STYLES = 'virtual:cms-site-styles';
const VIRTUAL_ASSETS = 'virtual:cms-asset-resolver';
// Synthetic stylesheet built from each registered theme's manifest at build
// time. Importing this from the generated entry causes Vite to emit a real
// <link rel="stylesheet"> in <head>, so theme CSS variables apply during the
// initial paint instead of after Vue hydrates.
const VIRTUAL_THEME_VARS = 'virtual:cms-theme-vars.css';
// Eager glob over `site/components/**/*.vue` so site-local Vue files can be
// referenced by basename in pages/{pageId}.json `components[]`. Resolution
// priority: site > extension > bundled (see useComponentResolver).
const VIRTUAL_SITE_COMPONENTS = 'virtual:cms-site-components';

const VIRTUAL_IDS = new Set([VIRTUAL_CONFIG, VIRTUAL_STYLES, VIRTUAL_ASSETS, VIRTUAL_THEME_VARS, VIRTUAL_SITE_COMPONENTS]);

// Entry file name (written to site repo root, gitignored, cleaned up in buildEnd)
const ENTRY_FILENAME = '.cms-entry.js';

// Initialize runtime singletons BEFORE importing the framework's main module.
// Framework components import resolver functions directly from the utility
// modules; those modules expose stub implementations until set*() is called.
//
// When external theme packages are provided via the `themes` option, the plugin
// generates additional import + registerTheme() calls so themes are available
// before the app renders.
function buildEntrySource(themePackages = [], extensionPackages = []) {
  const themeImports = themePackages.map(
    (pkg, i) => `import __theme${i} from '${pkg}';`
  ).join('\n');

  const themeRegistrations = themePackages.map(
    (_, i) => `registerTheme(__theme${i});`
  ).join('\n');

  const extImports = extensionPackages.map(
    (pkg, i) => `import __ext${i} from '${pkg}';`
  ).join('\n');

  const extRegistrations = extensionPackages.map(
    (_, i) => `await registerExtension(__ext${i});`
  ).join('\n');

  const needsThemeRegister = themePackages.length > 0;
  const needsExtRegister = extensionPackages.length > 0;

  // Use dynamic import for createCmsApp so that setConfigLoader/etc run
  // BEFORE ViteSSG's auto-mount IIFE.  Static imports are hoisted and
  // executed first, which means ViteSSG() would run before the runtime
  // singletons are initialized.
  return `
import { setConfigLoader } from '@koehler8/cms/utils/loadConfig';
import { setSiteStyleLoader } from '@koehler8/cms/utils/siteStyles';
import { setAssetResolver } from '@koehler8/cms/utils/assetResolver';
import { setSiteComponents } from '@koehler8/cms/utils/componentRegistry';
${needsThemeRegister ? `import { registerTheme } from '@koehler8/cms/themes/themeLoader';` : ''}
${needsExtRegister ? `import { registerExtension } from '@koehler8/cms/extensions/extensionLoader';` : ''}
${themeImports}
${extImports}

import * as __cmsConfig from '${VIRTUAL_CONFIG}';
import * as __cmsStyles from '${VIRTUAL_STYLES}';
import * as __cmsAssets from '${VIRTUAL_ASSETS}';
import * as __cmsSiteComponents from '${VIRTUAL_SITE_COMPONENTS}';
import '${VIRTUAL_THEME_VARS}';

setConfigLoader(__cmsConfig);
setSiteStyleLoader(__cmsStyles);
setAssetResolver(__cmsAssets);
setSiteComponents(__cmsSiteComponents);

${themeRegistrations}
${extRegistrations}

const { createCmsApp } = await import('@koehler8/cms/app');
export const createApp = createCmsApp();
`;
}

// Vite's convention: prefix resolved virtual IDs with \0 so they're not treated as real files
const resolved = (id) => `\0${id}`;
const isResolvedVirtual = (id) => id?.startsWith('\0virtual:cms-');

const htmlEscape = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * Render the index.html template with site metadata. Replaces EJS-style
 * <% const ... %> declarations with pre-computed values, then handles
 * <%= expr %> (escaped) and <%- expr %> (raw) substitutions.
 */
function renderTemplate(template, data) {
  const canonicalBase = (data.siteUrl || '').trim().replace(/\/+$/, '');
  const STATIC_LOGO_PATH = '/logo.png';
  const STATIC_OG_IMAGE_PATH = '/og-image.jpg';
  const ABSOLUTE_LOGO = canonicalBase ? `${canonicalBase}${STATIC_LOGO_PATH}` : STATIC_LOGO_PATH;
  const ABSOLUTE_OG_IMAGE = canonicalBase
    ? `${canonicalBase}${STATIC_OG_IMAGE_PATH}`
    : STATIC_OG_IMAGE_PATH;

  const scope = {
    ...data,
    STATIC_LOGO_PATH,
    STATIC_OG_IMAGE_PATH,
    canonicalBase,
    ABSOLUTE_LOGO,
    ABSOLUTE_OG_IMAGE,
  };

  // Strip <% ... %> blocks (declarations are pre-computed above)
  let out = template.replace(/<%[^=-][\s\S]*?%>/g, '');

  // <%- expr %> → raw value
  out = out.replace(/<%-\s*([\w$]+)\s*%>/g, (_, key) => String(scope[key] ?? ''));

  // <%= expr %> → HTML-escaped value
  out = out.replace(/<%=\s*([\w$]+)\s*%>/g, (_, key) => htmlEscape(scope[key]));

  return out;
}

function readIndexTemplate(frameworkRoot) {
  const templatePath = path.join(frameworkRoot, 'templates', 'index.html');
  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Discover CJS dependencies from extension packages that need pre-bundling.
 *
 * When Vite serves ESM packages raw from node_modules, their CJS deps don't
 * get the CJS→ESM default-export shim and cause runtime SyntaxErrors.  This
 * scans each extension package.json's `dependencies` and collects any that
 * ship CJS (no "type": "module" in their package.json).
 */
function findPkgJson(name, fromDir) {
  // Walk up node_modules to find the package directory, then read its package.json.
  // This avoids require.resolve which can fail when exports doesn't include ./package.json.
  const nmDir = path.join(fromDir, 'node_modules');
  const pkgDir = name.startsWith('@')
    ? path.join(nmDir, ...name.split('/'))
    : path.join(nmDir, name);
  const pkgPath = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  }
  return null;
}

function discoverExtensionCjsDeps(extensionPackages, projectRoot) {
  const SKIP = new Set(['vue', 'vue-router', 'pinia']);
  const cjsDeps = new Set();
  const visited = new Set();

  function scanDeps(pkgName) {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);
    if (SKIP.has(pkgName) || pkgName.startsWith('@koehler8/cms')) return;

    const pkg = findPkgJson(pkgName, projectRoot);
    if (!pkg) return;

    // Both CJS and ESM packages are included so their CJS deps get shimmed
    cjsDeps.add(pkgName);

    // Recurse into dependencies
    for (const dep of Object.keys(pkg.dependencies || {})) {
      scanDeps(dep);
    }
  }

  for (const pkg of extensionPackages) {
    const extPkg = findPkgJson(pkg, projectRoot);
    if (!extPkg) continue;
    for (const dep of Object.keys(extPkg.dependencies || {})) {
      scanDeps(dep);
    }
  }
  return [...cjsDeps];
}

export default function cmsPlugin(options = {}) {
  const {
    siteDir: siteDirOption = './site',
    frameworkRoot: frameworkRootOption = __dirname,
    themes: themePackages = [],
    extensions: extensionPackages = [],
  } = options;
  // The previous `locales` option is no longer accepted: per-site available
  // locales are now discovered from on-disk content directories. Passing
  // `locales` is silently ignored (kept here as a destructure to swallow it
  // gracefully; the `SUPPORTED_LOCALES` constant remains exported only for
  // any consumer that imports it directly).

  // These are resolved relative to the project cwd at config time
  let siteDir;
  let siteRoot; // project root — parent of siteDir
  let frameworkRoot;
  let siteConfig;
  let baseLocale = 'en';
  let availableLocales = [];
  let pagePaths;
  let metadata;
  let tempIndexPath;
  let tempEntryPath;

  const writeTempFiles = () => {
    // Write entry file (with optional external theme registrations)
    fs.writeFileSync(tempEntryPath, buildEntrySource(themePackages, extensionPackages), 'utf-8');

    // Write index.html with site metadata injected and script src pointing
    // at the entry file
    const template = readIndexTemplate(frameworkRoot);
    const html = renderTemplate(template, {
      site: metadata.siteTitle,
      siteDescription: metadata.siteDescription,
      siteUrl: metadata.siteUrl,
      siteGoogleId: metadata.siteGoogleId,
      siteSameAsJson: metadata.siteSameAsJson,
      manifestThemeColor: metadata.manifestThemeColor,
    });

    const processed = html.replace(
      /<script\s+type="module"\s+src="\/src\/main\.js"\s*>\s*<\/script>/,
      `<script type="module" src="/${ENTRY_FILENAME}"></script>`
    );

    fs.writeFileSync(tempIndexPath, processed, 'utf-8');
  };

  const cleanupTempFiles = () => {
    for (const p of [tempIndexPath, tempEntryPath]) {
      if (p && fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* noop */ }
      }
    }
  };

  // Recursively mirror files from src → dest, skipping any file that already
  // exists in dest (so site-specific files win over framework defaults).
  const mirrorDir = (src, dest) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        mirrorDir(srcPath, destPath);
      } else if (entry.isFile()) {
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  };

  const syncPublicDir = () => {
    const sitePublicDir = path.join(siteRoot, 'public');
    const frameworkPublicDir = path.join(frameworkRoot, 'public');
    mirrorDir(frameworkPublicDir, sitePublicDir);
  };

  // Generate robots.txt and sitemap.xml from the inflated site config and
  // write them to siteRoot/public/. Runs after syncPublicDir so dynamic
  // output overwrites any framework or stale static copy. Sites pick up
  // changes by rebuilding (the existing edit-JSON-rebuild-deploy flow).
  const writeSeoFiles = () => {
    const sitePublicDir = path.join(siteRoot, 'public');
    fs.mkdirSync(sitePublicDir, { recursive: true });

    const sitemapXml = buildSitemap(siteConfig, { availableLocales, baseLocale });
    const sitemapPath = path.join(sitePublicDir, 'sitemap.xml');
    if (sitemapXml) {
      fs.writeFileSync(sitemapPath, sitemapXml, 'utf-8');
    } else if (fs.existsSync(sitemapPath)) {
      // Stale sitemap from a previous build (e.g. site.url was removed, or
      // every page is now draft). Drop it so crawlers don't get a list of
      // URLs that no longer apply.
      try { fs.unlinkSync(sitemapPath); } catch { /* noop */ }
    }

    const sitemapUrl = sitemapXml ? getSitemapUrl(siteConfig) : '';
    const robotsBody = buildRobotsTxt(siteConfig, sitemapUrl);
    fs.writeFileSync(path.join(sitePublicDir, 'robots.txt'), robotsBody, 'utf-8');

    // Web App Manifest. The template emits <link rel="manifest"> on every
    // page; browsers use this to enable Add-to-Home-Screen + control
    // splash colors when the site is launched from a homescreen icon.
    const manifest = buildWebAppManifest(siteConfig);
    fs.writeFileSync(
      path.join(sitePublicDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8',
    );
  };

  const cmsCore = {
    name: '@koehler8/cms',
    enforce: 'pre',

    config(userConfig, env) {
      // Resolve absolute paths
      frameworkRoot = path.resolve(frameworkRootOption);
      siteDir = path.isAbsolute(siteDirOption)
        ? siteDirOption
        : path.resolve(process.cwd(), siteDirOption);
      siteRoot = path.dirname(siteDir);
      tempIndexPath = path.join(siteRoot, 'index.html');
      tempEntryPath = path.join(siteRoot, ENTRY_FILENAME);

      // Load site config at config-resolution time (needed for SSG routes + HTML injection)
      const contentDir = path.join(siteDir, 'content');
      const contentConfigPath = path.join(contentDir, 'content.config.json');
      const contentConfig = fs.existsSync(contentConfigPath)
        ? JSON.parse(fs.readFileSync(contentConfigPath, 'utf-8'))
        : {};
      baseLocale = contentConfig.baseLocale || 'en';
      const configDir = path.join(contentDir, baseLocale);
      siteConfig = loadSplitConfig(configDir);
      if (!siteConfig) {
        throw new Error(`[@koehler8/cms] site config not found at ${configDir}`);
      }
      // Discover locales actually present on disk: any directory under
      // content/ that has at least one of `site.json`, `shared.json`, or
      // a `pages/` subdir is treated as a real locale. (Earlier the check
      // required `site.json` specifically — too strict for sites that
      // author per-locale page overrides without overriding the site
      // metadata, which is the common pattern for translation-only locale
      // dirs.)
      const localeDirHasContent = (dir) =>
        fs.existsSync(path.join(dir, 'site.json'))
        || fs.existsSync(path.join(dir, 'shared.json'))
        || fs.existsSync(path.join(dir, 'pages'));
      availableLocales = fs.existsSync(contentDir)
        ? fs
            .readdirSync(contentDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .filter((name) => localeDirHasContent(path.join(contentDir, name)))
            .sort()
        : [];
      pagePaths = collectPagePaths(siteConfig);
      metadata = extractSiteMetadata(siteConfig);

      const extensionsDir = path.join(frameworkRoot, 'extensions');
      const extensionSetupFiles = collectExtensionSetupFiles(extensionsDir);

      const isTestEnv = process.env.VITEST === 'true';

      return {
        resolve: {
          alias: {
            '@cms-site': siteDir,
            '@cms-framework': frameworkRoot,
            '@': path.join(frameworkRoot, 'src'),
            '@extensions': extensionsDir,
          },
        },
        optimizeDeps: {
          // vue and vue-router MUST NOT be pre-bundled (inlined) into
          // @koehler8/cms chunks — if they are, .vue components served raw
          // from node_modules get a different vue-router instance than
          // the one ViteSSG used, and <RouterView> can't find the
          // injected router context (renders empty).
          exclude: ['vue', 'vue-router', 'pinia', '@koehler8/cms', ...extensionPackages],
          include: [
            // CJS deps imported directly by framework source
            'ajv',
            'ajv/dist/2020',
            'ajv/dist/2020.js',
            'ajv-formats',
            // Auto-discovered CJS deps from extension packages.
            // Extensions may depend on ESM packages that import CJS modules;
            // these must be pre-bundled for proper default-export shims.
            ...discoverExtensionCjsDeps(extensionPackages, siteRoot),
          ],
        },
        root: siteRoot,
        // Site repo's public dir contains generated favicon/logo/og-image.
        // The plugin mirrors framework public files into it during
        // configResolved so fonts, maps, etc. are also available.
        publicDir: path.join(siteRoot, 'public'),
        build: {
          modulePreload: false,
          rollupOptions: {
            input: tempIndexPath,
            output: {
              manualChunks(id) {
                if (
                  id.includes('node_modules/vue/') ||
                  id.includes('node_modules/vue-router/') ||
                  id.includes('node_modules/pinia/')
                ) {
                  return 'vendor-vue';
                }
                if (
                  id.includes('node_modules/chart.js/') ||
                  id.includes('node_modules/chartjs-plugin-datalabels/') ||
                  id.includes('node_modules/vue-chartjs/')
                ) {
                  return 'vendor-charts';
                }
              },
            },
          },
        },
        ssr: {
          // Extension packages contain .vue SFCs and JSON imports that Node's
          // native ESM resolver cannot handle.  Marking them as noExternal
          // tells Vite to bundle them during SSR so its Vue/JSON plugins
          // process the files instead of Node.
          noExternal: ['@koehler8/cms', ...themePackages, ...extensionPackages],
        },
        test: {
          environment: 'happy-dom',
          globals: true,
          include: ['tests/**/*.spec.{js,ts}', 'extensions/*/tests/**/*.spec.{js,ts}'],
          setupFiles: extensionSetupFiles,
        },
        ssgOptions: {
          dirStyle: 'nested',
          // After vite-ssg pre-renders every route, copy the rendered
          // dist/404/index.html to dist/404.html. AWS Amplify (and most
          // static hosts) auto-serve a top-level 404.html for any
          // unmatched URL with HTTP status 404, so this gives sites a
          // proper not-found response without per-site config.
          onFinished() {
            const distDir = path.join(siteRoot, 'dist');
            const nestedNotFound = path.join(distDir, '404', 'index.html');
            const flatNotFound = path.join(distDir, '404.html');
            if (fs.existsSync(nestedNotFound)) {
              try {
                fs.copyFileSync(nestedNotFound, flatNotFound);
              } catch (err) {
                console.warn(`[@koehler8/cms] failed to write 404.html: ${err.message}`);
              }
            }
          },
          includedRoutes(paths) {
            // /admin is a vestigial placeholder; /404 is the not-found
            // landing page (rendered via the catch-all + NotFound
            // component). onFinished above copies dist/404/index.html
            // to dist/404.html so AWS Amplify serves it for unmatched
            // URLs with HTTP 404.
            const staticRoutes = new Set(['/admin', '/404']);
            pagePaths.forEach((routePath) => staticRoutes.add(routePath));

            // Pre-render every page under each non-base locale prefix that
            // actually has a content directory on disk. The base locale is
            // served at the unprefixed path (it's already covered by
            // staticRoutes) — emitting `/{baseLocale}/path` would create
            // duplicate URLs that all render the same content.
            const localePrefixes = availableLocales.filter((l) => l !== baseLocale);
            const localizedRoutes = new Set();
            localePrefixes.forEach((locale) => {
              pagePaths.forEach((routePath) => {
                const localized =
                  routePath === '/' ? `/${locale}` : `/${locale}${routePath}`;
                localizedRoutes.add(localized);
              });
            });

            const candidates = [
              ...paths.filter((routePath) => !routePath.includes(':')),
              ...Array.from(staticRoutes),
              ...Array.from(localizedRoutes),
            ];
            return Array.from(new Set(candidates));
          },
        },
      };
    },

    resolveId(id) {
      if (VIRTUAL_IDS.has(id)) {
        return resolved(id);
      }
      return null;
    },

    async load(id) {
      if (!isResolvedVirtual(id)) return null;
      const virtualId = id.slice(1); // strip leading \0

      if (virtualId === VIRTUAL_THEME_VARS) {
        // Build a stylesheet by deriving CSS variables from each registered
        // theme's manifest at build time. We resolve the theme package via
        // the site's node_modules (createRequire from siteRoot) and import
        // its pure manifest through the package's `./config` exports field
        // (which points at theme.config.js — sidestepping any Vite-only
        // imports the theme's index.js may have, e.g. `?inline` CSS or a
        // side-effect `import './theme.css'`). The bundled `base` theme is
        // always included so sites without a `themes` option still get a
        // sync theme.
        const { buildCssVarMap, renderCssVarRule } = await import(
          './src/themes/buildCssVarMap.js'
        );
        const baseManifestModule = await import('./themes/base/theme.config.js');
        const baseManifest = baseManifestModule.default || baseManifestModule;

        const requireFromSite = createRequire(path.join(siteRoot, 'package.json'));

        const blocks = [];
        const seen = new Set();

        const addManifest = (manifest, sourceLabel) => {
          if (!manifest || typeof manifest !== 'object') return;
          const slug = typeof manifest.slug === 'string' ? manifest.slug.trim().toLowerCase() : '';
          if (!slug || seen.has(slug)) return;
          seen.add(slug);
          const vars = buildCssVarMap(manifest);
          if (Object.keys(vars).length === 0) return;
          const selector = `:root[data-site-theme="${slug}"]`;
          blocks.push(`/* ${sourceLabel} */\n${renderCssVarRule(selector, vars)}`);
        };

        addManifest(baseManifest, '@koehler8/cms (base)');

        for (const pkg of themePackages) {
          let manifestPath;
          try {
            manifestPath = requireFromSite.resolve(`${pkg}/config`);
          } catch (err) {
            this.warn(`[cms-vite-plugin] Theme "${pkg}" does not expose a "./config" export pointing at theme.config.js; skipping. (${err.message})`);
            continue;
          }
          let manifest;
          try {
            const mod = await import(pathToFileURL(manifestPath).href);
            manifest = mod.default || mod.manifest || mod;
          } catch (err) {
            this.warn(`[cms-vite-plugin] Failed to load theme manifest from "${pkg}": ${err.message}`);
            continue;
          }
          addManifest(manifest, pkg);
        }

        return blocks.join('\n\n') + '\n';
      }

      if (virtualId === VIRTUAL_CONFIG) {
        return `
import { createConfigLoader } from '@koehler8/cms/utils/loadConfig';
const allModules = import.meta.glob('@cms-site/content/**/*.json');
const loader = createConfigLoader(allModules);
export const loadConfigData = loader.loadConfigData;
export const mergeConfigTrees = loader.mergeConfigTrees;
export const cloneConfig = loader.cloneConfig;
// availableLocales + baseLocale are emitted as build-time literals derived
// from the same on-disk discovery the plugin uses for SSG includedRoutes
// and sitemap generation. This guarantees the runtime sees the exact same
// locale list as the build, regardless of glob-based heuristics.
export const availableLocales = ${JSON.stringify(availableLocales)};
export const baseLocale = ${JSON.stringify(baseLocale)};
`;
      }

      if (virtualId === VIRTUAL_STYLES) {
        return `
import { createSiteStyleLoader } from '@koehler8/cms/utils/siteStyles';
const styleModules = import.meta.glob('@cms-site/style.css');
const loader = createSiteStyleLoader(styleModules);
export const ensureSiteStylesLoaded = loader.ensureSiteStylesLoaded;
`;
      }

      if (virtualId === VIRTUAL_SITE_COMPONENTS) {
        // Eager glob — Vite resolves each match at build time and inlines
        // the imported components. The result is a bare object literal of
        // the form { './path/to/Foo.vue': ModuleLike } that componentRegistry
        // re-keys by basename.
        return `
const modules = import.meta.glob('@cms-site/components/**/*.vue', { eager: true });
export default modules;
`;
      }

      if (virtualId === VIRTUAL_ASSETS) {
        return `
import { createAssetResolver } from '@koehler8/cms/utils/assetResolver';
const shared = import.meta.glob('@cms-framework/src/assets/**/*', {
  eager: true,
  query: '?url',
  import: 'default',
});
const site = import.meta.glob([
  '@cms-site/assets/**/*',
  '!@cms-site/assets/_source/**',
], {
  eager: true,
  query: '?url',
  import: 'default',
});
const resolver = createAssetResolver(shared, site);
export const resolveAssetUrl = resolver.resolveAssetUrl;
export const resolveAsset = resolver.resolveAsset;
export const resolveMedia = resolver.resolveMedia;
export const assetUrlMap = resolver.assetUrlMap;
`;
      }

      return null;
    },

    async transform(code, id) {
      // Strip plaintext draftPassword from any site.json under content/
      // before it lands in the bundle. The runtime reads the resulting
      // draftPasswordHash via siteData and verifies user input against
      // the hash. enforce: 'pre' on this plugin runs the transform before
      // Vite's built-in JSON plugin converts the file to a JS module.
      if (!id) return null;
      const idPath = id.split('?')[0];
      if (!idPath.endsWith('/site.json')) return null;
      if (!idPath.includes(`${path.sep}content${path.sep}`) && !idPath.includes('/content/')) {
        return null;
      }
      const transformed = await transformSiteJson(code);
      if (transformed == null) return null;
      return { code: transformed, map: null };
    },

    configResolved(resolvedConfig) {
      // Write temp files as soon as config is resolved so vite-ssg's
      // detectEntry (which runs before Vite's build lifecycle) finds them.
      writeTempFiles();

      // Mirror framework's public/ into the site's public/ so fonts, maps,
      // etc. end up in dist. Site-specific files (favicon.ico, logo.png,
      // og-image.jpg written by generate-public-assets) win over any
      // accidental collisions because we skip files that already exist.
      syncPublicDir();

      // robots.txt and sitemap.xml are generated from the inflated site
      // config (so per-site draft state regenerates on every build).
      writeSeoFiles();
    },

    buildEnd() {
      // Only clean up during actual builds, not dev server
      if (!this._isDevServer) cleanupTempFiles();
    },

    closeBundle() {
      // Only clean up during actual builds, not dev server
      if (!this._isDevServer) cleanupTempFiles();
    },

    configureServer(server) {
      // Mark that we're running as a dev server so buildEnd/closeBundle
      // don't prematurely delete the temp files.
      this._isDevServer = true;

      // Clean up only when the dev server actually closes
      server.httpServer?.once('close', cleanupTempFiles);
      process.once('exit', cleanupTempFiles);
      process.once('SIGINT', () => { cleanupTempFiles(); process.exit(0); });
      process.once('SIGTERM', () => { cleanupTempFiles(); process.exit(0); });

      // Serve the entry JS directly from memory so it's always available
      // even if the temp file was deleted by a stale process or race condition.
      // Use Vite's transformRequest to resolve bare module specifiers.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url === `/${ENTRY_FILENAME}`) {
          try {
            // Ensure the temp file exists for Vite's module graph
            if (!fs.existsSync(tempEntryPath)) {
              fs.writeFileSync(tempEntryPath, buildEntrySource(themePackages, extensionPackages), 'utf-8');
            }
            // Let Vite transform it (resolves bare specifiers, applies plugins)
            const result = await server.transformRequest(`/${ENTRY_FILENAME}`);
            if (result) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/javascript');
              res.end(result.code);
              return;
            }
          } catch (e) {
            // Fall through to next middleware
          }
        }
        next();
      });

      // Watch site content for HMR
      server.watcher.add(siteDir);

      // Invalidate virtual modules when site content changes
      const invalidate = (file) => {
        if (!file.startsWith(siteDir)) return;
        for (const id of VIRTUAL_IDS) {
          const mod = server.moduleGraph.getModuleById(resolved(id));
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', invalidate);
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);

      // Serve index.html on root request in dev mode
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== '/' && req.url !== '/index.html') {
            return next();
          }

          try {
            const template = readIndexTemplate(frameworkRoot);
            let html = renderTemplate(template, {
              site: metadata.siteTitle,
              siteDescription: metadata.siteDescription,
              siteUrl: metadata.siteUrl,
              siteGoogleId: metadata.siteGoogleId,
              siteSameAsJson: metadata.siteSameAsJson,
              manifestThemeColor: metadata.manifestThemeColor,
            });

            html = html.replace(
              /<script\s+type="module"\s+src="\/src\/main\.js"\s*>\s*<\/script>/,
              `<script type="module" src="/${ENTRY_FILENAME}"></script>`
            );

            html = await server.transformIndexHtml(req.url, html, req.originalUrl);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          } catch (err) {
            next(err);
          }
        });
      };
    },
  };

  return [vue(), cmsCore];
}
