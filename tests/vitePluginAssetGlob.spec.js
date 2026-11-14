// @vitest-environment node
//
// The asset-resolver virtual module's site glob is eager with `?url`, so every
// file it matches is emitted to dist/assets/ (or base64-inlined into the entry
// chunk when small) and served publicly, referenced or not. These tests run a
// real Vite build of the generated module against a fixture site and assert
// which files make it into the asset map and the build output.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import {
  buildAssetResolverSource,
  SITE_ASSET_EXCLUDED_DIRS,
  SITE_ASSET_EXCLUDED_EXTENSIONS,
  SITE_ASSET_GLOBS,
} from '../vite-plugin.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Path under site/assets/ → whether it must be in the asset map.
const FIXTURE_FILES = {
  // Runtime assets: images, media and data a page can name.
  'img/hero-photo.jpg': true,
  'img/team/portrait-jo.png': true,
  'logo-mark.svg': true,
  'media/intro-clip.mp4': true,
  'data/spinner-anim.json': true,
  // A directory whose name merely contains "_source" is not a build input.
  'img/not_source/kept-shot.png': true,

  // `_source/` at any depth is build input, whatever the file type.
  '_source/rasterize.mjs': false,
  '_source/promo-board.pxd': false,
  '_source/og-master.svg': false,
  '_source/gen/persona-render.png': false,
  '_source/fonts/Display-Regular.ttf': false,
  '_source/fonts/OFL.txt': false,
  'img/_source/legacy-original.jpg': false,

  // Scripts, notes and design documents are excluded anywhere.
  'build-banners.mjs': false,
  'tools/generate-art.sh': false,
  'notes/README.md': false,
  'img/layered-hero.psd': false,
};

let tmpRoot;
let mapKeys;
let emittedNames;

async function buildFixture() {
  // realpath: on macOS os.tmpdir() sits behind the /var → /private/var
  // symlink, and glob keys are only root-relative when the root is real.
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cms-asset-glob-')));
  const siteDir = path.join(tmpRoot, 'site');
  const cacheDir = path.join(tmpRoot, 'variant-cache');
  for (const rel of Object.keys(FIXTURE_FILES)) {
    const abs = path.join(siteDir, 'assets', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Distinct content per file so Vite never dedupes two into one asset.
    fs.writeFileSync(abs, `fixture:${rel}\n`);
  }
  fs.writeFileSync(path.join(siteDir, 'assets', '.DS_Store'), 'finder');
  fs.mkdirSync(path.join(cacheDir, 'assets', 'img'), { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'assets', 'img', 'hero-photo-640.webp'), 'variant');

  const RESOLVER_ID = 'virtual:cms-asset-resolver';
  const ENTRY_ID = 'virtual:fixture-entry';
  const output = await build({
    configFile: false,
    root: tmpRoot,
    logLevel: 'silent',
    resolve: {
      alias: {
        '@cms-site': siteDir,
        '@cms-framework': repoRoot,
        '@cms-variant-cache': cacheDir,
        '@koehler8/cms/utils/assetResolver': path.join(repoRoot, 'src/utils/assetResolver.js'),
      },
    },
    plugins: [{
      name: 'asset-resolver-fixture',
      resolveId(id) {
        if (id === RESOLVER_ID || id === ENTRY_ID) return `\0${id}`;
        return null;
      },
      load(id) {
        if (id === `\0${RESOLVER_ID}`) return buildAssetResolverSource();
        if (id === `\0${ENTRY_ID}`) {
          return `import { assetUrlMap } from '${RESOLVER_ID}';\nglobalThis.__cmsAssets = assetUrlMap;\n`;
        }
        return null;
      },
    }],
    build: {
      write: false,
      minify: false,
      // Emit every match as a file so the output listing shows exactly what
      // a deploy would publish.
      assetsInlineLimit: 0,
      rollupOptions: { input: ENTRY_ID },
    },
  });

  const bundles = Array.isArray(output) ? output : [output];
  const items = bundles.flatMap((b) => b.output);
  const code = items.filter((i) => i.type === 'chunk').map((c) => c.code).join('\n');
  // Glob keys are root-relative ("/site/assets/img/x.jpg"); the resolver
  // strips through `assets/`, so key them the same way.
  mapKeys = new Set(
    [...code.matchAll(/["']\/site\/assets\/([^"']+)["']\s*:/g)].map((m) => m[1]),
  );
  expect(mapKeys.size).toBeGreaterThan(0);
  emittedNames = items.filter((i) => i.type === 'asset').map((a) => path.basename(a.fileName));
}

describe('asset-resolver site glob', () => {
  beforeAll(buildFixture, 60_000);
  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('keeps runtime assets in the asset map', () => {
    for (const [rel, kept] of Object.entries(FIXTURE_FILES)) {
      if (kept) expect(mapKeys, rel).toContain(rel);
    }
  });

  it('leaves build inputs out of the asset map', () => {
    for (const [rel, kept] of Object.entries(FIXTURE_FILES)) {
      if (!kept) expect(mapKeys, rel).not.toContain(rel);
    }
    expect([...mapKeys].some((k) => k.includes('.DS_Store'))).toBe(false);
  });

  it('emits no build input to the output', () => {
    for (const [rel, kept] of Object.entries(FIXTURE_FILES)) {
      const stem = path.basename(rel, path.extname(rel));
      const emitted = emittedNames.some((n) => n.startsWith(`${stem}-`));
      expect(emitted, `${rel} emitted`).toBe(kept);
    }
  });

  it('still emits generated variants from the cache glob', () => {
    expect(emittedNames.some((n) => n.startsWith('hero-photo-640-'))).toBe(true);
  });
});

describe('site asset exclusions', () => {
  it('anchors every negative pattern to the site alias', () => {
    const negatives = SITE_ASSET_GLOBS.filter((g) => g.startsWith('!'));
    expect(negatives.length).toBe(SITE_ASSET_EXCLUDED_DIRS.length + 1);
    for (const g of negatives) expect(g.startsWith('!@cms-site/assets/')).toBe(true);
  });

  it('never excludes an image, media or data type', () => {
    const runtime = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg', 'ico', 'mp4', 'webm', 'mp3', 'pdf', 'json', 'woff', 'woff2'];
    for (const ext of runtime) expect(SITE_ASSET_EXCLUDED_EXTENSIONS).not.toContain(ext);
  });
});
