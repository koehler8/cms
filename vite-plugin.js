/**
 * @koehler8/cms Vite plugin
 *
 * Generates virtual modules that wire site-specific content (config, assets,
 * styles) into the CMS framework. Site repos consume this via a 3-line
 * vite.config.js and otherwise contain only content.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';

import { SUPPORTED_LOCALES } from './src/constants/locales.js';

// ---- Helpers ----

function loadSplitConfig(configDir) {
  const sitePath = path.join(configDir, 'site.json');
  if (!fs.existsSync(sitePath)) return null;

  const site = JSON.parse(fs.readFileSync(sitePath, 'utf-8'));
  const sharedPath = path.join(configDir, 'shared.json');
  const shared = fs.existsSync(sharedPath) ? JSON.parse(fs.readFileSync(sharedPath, 'utf-8')) : {};

  const pagesDir = path.join(configDir, 'pages');
  const pages = {};
  if (fs.existsSync(pagesDir)) {
    for (const file of fs.readdirSync(pagesDir)) {
      if (!file.endsWith('.json')) continue;
      const pageId = file.replace('.json', '');
      pages[pageId] = JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf-8'));
    }
  }

  return { site, shared, pages };
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
  } = siteConfig.site || {};

  const siteSameAsList = Array.isArray(siteSameAs)
    ? siteSameAs.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  const siteSameAsJson = JSON.stringify(siteSameAsList);

  return { siteTitle, siteDescription, siteUrl, siteGoogleId, siteSameAsJson };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Virtual module IDs (config, styles, assets — the entry is a real file on disk)
const VIRTUAL_CONFIG = 'virtual:cms-config-loader';
const VIRTUAL_STYLES = 'virtual:cms-site-styles';
const VIRTUAL_ASSETS = 'virtual:cms-asset-resolver';

const VIRTUAL_IDS = new Set([VIRTUAL_CONFIG, VIRTUAL_STYLES, VIRTUAL_ASSETS]);

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
${needsThemeRegister ? `import { registerTheme } from '@koehler8/cms/themes/themeLoader';` : ''}
${needsExtRegister ? `import { registerExtension } from '@koehler8/cms/extensions/extensionLoader';` : ''}
${themeImports}
${extImports}

import * as __cmsConfig from '${VIRTUAL_CONFIG}';
import * as __cmsStyles from '${VIRTUAL_STYLES}';
import * as __cmsAssets from '${VIRTUAL_ASSETS}';

setConfigLoader(__cmsConfig);
setSiteStyleLoader(__cmsStyles);
setAssetResolver(__cmsAssets);

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
    locales = SUPPORTED_LOCALES,
    themes: themePackages = [],
    extensions: extensionPackages = [],
  } = options;

  // These are resolved relative to the project cwd at config time
  let siteDir;
  let siteRoot; // project root — parent of siteDir
  let frameworkRoot;
  let siteConfig;
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
      const configDir = path.join(siteDir, 'config');
      siteConfig = loadSplitConfig(configDir);
      if (!siteConfig) {
        throw new Error(`[@koehler8/cms] site config not found at ${configDir}`);
      }
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
        test: {
          environment: 'happy-dom',
          globals: true,
          include: ['tests/**/*.spec.{js,ts}', 'extensions/*/tests/**/*.spec.{js,ts}'],
          setupFiles: extensionSetupFiles,
        },
        ssgOptions: {
          dirStyle: 'nested',
          includedRoutes(paths) {
            const staticRoutes = new Set(['/admin']);
            pagePaths.forEach((routePath) => staticRoutes.add(routePath));

            const localizedRoutes = new Set();
            locales.forEach((locale) => {
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

    load(id) {
      if (!isResolvedVirtual(id)) return null;
      const virtualId = id.slice(1); // strip leading \0

      if (virtualId === VIRTUAL_CONFIG) {
        return `
import { createConfigLoader } from '@koehler8/cms/utils/loadConfig';
const allModules = import.meta.glob('@cms-site/config/**/*.json');
const loader = createConfigLoader(allModules);
export const loadConfigData = loader.loadConfigData;
export const mergeConfigTrees = loader.mergeConfigTrees;
export const cloneConfig = loader.cloneConfig;
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

    configResolved(resolvedConfig) {
      // Write temp files as soon as config is resolved so vite-ssg's
      // detectEntry (which runs before Vite's build lifecycle) finds them.
      writeTempFiles();

      // Mirror framework's public/ into the site's public/ so fonts, maps,
      // robots.txt, etc. end up in dist. Site-specific files (favicon.ico,
      // logo.png, og-image.jpg written by generate-public-assets) win over
      // any accidental collisions because we skip files that already exist.
      syncPublicDir();
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
