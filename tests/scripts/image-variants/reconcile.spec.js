import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { planVariantJobsFromFlatDir } from '../../../scripts/image-variants/planner.js';
import { reconcileVariantCache } from '../../../scripts/image-variants/reconcile.js';
import { readManifest } from '../../../scripts/image-variants/manifest.js';
import { makeFixtureSite, noop } from './helpers.js';

const CONFIG = {
  widths: [320, 640],
  formats: ['avif', 'webp', 'jpg'],
  quality: { avif: 60, webp: 75, jpg: 80 },
};

async function makeRun({ sourceImages }) {
  const fixture = await makeFixtureSite({ sourceImages });
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-iv-cache-'));
  const manifestPath = path.join(cacheDir, '.manifest.json');
  const cleanup = async () => {
    await fixture.cleanup();
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  };
  return { fixture, cacheDir, manifestPath, cleanup };
}

function plan(fixture) {
  return planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config: CONFIG });
}

describe('reconcileVariantCache', () => {
  let ctx;
  afterEach(async () => { if (ctx) await ctx.cleanup(); });

  it('generates the full matrix on a clean run', async () => {
    ctx = await makeRun({ sourceImages: { 'hero.jpg': { width: 1600, height: 900 } } });
    const result = await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    expect(result.generated).toBe(6); // 2 widths × 3 formats
    expect(result.skipped).toBe(0);
    expect(result.evicted).toBe(0);
    for (const w of CONFIG.widths) {
      for (const f of ['avif', 'webp', 'jpg']) {
        expect(fs.existsSync(path.join(ctx.cacheDir, 'assets/img', `hero-${w}.${f}`))).toBe(true);
      }
    }
  });

  it('writes a manifest reflecting the generated state', async () => {
    ctx = await makeRun({ sourceImages: { 'hero.jpg': { width: 1600, height: 900 } } });
    await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    const m = readManifest(ctx.manifestPath);
    expect(m).toBeTruthy();
    expect(m.config).toEqual(CONFIG);
    expect(Object.keys(m.sources)).toEqual(['img/hero.jpg']);
    expect(m.sources['img/hero.jpg'].variants).toContain('assets/img/hero-320.webp');
  });

  it('skips up-to-date variants on re-run', async () => {
    ctx = await makeRun({ sourceImages: { 'hero.jpg': { width: 1600, height: 900 } } });
    const args = {
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    };
    await reconcileVariantCache(args);
    const result = await reconcileVariantCache({ ...args, jobs: plan(ctx.fixture) });
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(6);
  });

  it('regenerates when source mtime is newer than manifest', async () => {
    ctx = await makeRun({ sourceImages: { 'hero.jpg': { width: 1600, height: 900 } } });
    await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    const heroPath = path.join(ctx.fixture.imgDir, 'hero.jpg');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(heroPath, future, future);
    const result = await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    expect(result.generated).toBe(6);
  });

  it('regenerates when config changed (widths added)', async () => {
    ctx = await makeRun({ sourceImages: { 'hero.jpg': { width: 1600, height: 900 } } });
    await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    const newConfig = { ...CONFIG, widths: [320, 640, 960] };
    const newJobs = planVariantJobsFromFlatDir({ siteImgDir: ctx.fixture.imgDir, config: newConfig });
    const result = await reconcileVariantCache({
      jobs: newJobs,
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: newConfig,
      log: noop,
    });
    expect(result.generated).toBe(9); // 3 widths × 3 formats
  });

  it('evicts variants for sources removed since last run', async () => {
    ctx = await makeRun({
      sourceImages: {
        'hero.jpg': { width: 1600, height: 900 },
        'logo.png': { width: 200, height: 200, ext: 'png' },
      },
    });
    await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    expect(fs.existsSync(path.join(ctx.cacheDir, 'assets/img/logo-320.webp'))).toBe(true);

    fs.rmSync(path.join(ctx.fixture.imgDir, 'logo.png'));
    const result = await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    expect(result.evicted).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(ctx.cacheDir, 'assets/img/logo-320.webp'))).toBe(false);
  });

  it('regenerates if cache file was wiped despite manifest claiming it exists', async () => {
    ctx = await makeRun({ sourceImages: { 'hero.jpg': { width: 1600, height: 900 } } });
    await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    fs.rmSync(path.join(ctx.cacheDir, 'assets/img/hero-320.webp'));
    const result = await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    expect(result.generated).toBe(6);
  });

  it('clamps to source size for tiny images (no enlargement)', async () => {
    ctx = await makeRun({ sourceImages: { 'logo.png': { width: 200, height: 200, ext: 'png' } } });
    await reconcileVariantCache({
      jobs: plan(ctx.fixture),
      cacheDir: ctx.cacheDir,
      manifestPath: ctx.manifestPath,
      currentConfig: CONFIG,
      log: noop,
    });
    const out320 = path.join(ctx.cacheDir, 'assets/img/logo-320.webp');
    const out640 = path.join(ctx.cacheDir, 'assets/img/logo-640.webp');
    const meta320 = await sharp(out320).metadata();
    const meta640 = await sharp(out640).metadata();
    expect(meta320.width).toBe(200);
    expect(meta640.width).toBe(200);
  });
});
