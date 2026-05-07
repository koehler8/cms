import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { planVariantJobsFromFlatDir } from '../../../scripts/image-variants/planner.js';
import { makeFixtureSite } from './helpers.js';

describe('planVariantJobsFromFlatDir', () => {
  let fixture;
  afterEach(async () => { if (fixture) await fixture.cleanup(); });

  it('plans width × format jobs for one flat-dir original', async () => {
    fixture = await makeFixtureSite({
      sourceImages: { 'hero.jpg': { width: 1600, height: 900 } },
    });
    const config = { widths: [640, 1280], formats: ['avif', 'webp'] };
    const jobs = planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceKey).toBe('img/hero.jpg');
    expect(jobs[0].outputs).toHaveLength(4);
    const cachePaths = jobs[0].outputs.map((o) => o.cacheRelPath).sort();
    expect(cachePaths).toEqual([
      'assets/img/hero-1280.avif',
      'assets/img/hero-1280.webp',
      'assets/img/hero-640.avif',
      'assets/img/hero-640.webp',
    ]);
  });

  it('preserves subdirectory layout in cacheRelPath', async () => {
    fixture = await makeFixtureSite({
      sourceImages: { 'team/jamie.jpg': { width: 800, height: 800 } },
    });
    const config = { widths: [320], formats: ['webp'] };
    const jobs = planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceKey).toBe('img/team/jamie.jpg');
    expect(jobs[0].outputs[0].cacheRelPath).toBe('assets/img/team/jamie-320.webp');
  });

  it('skips files matching the variant pattern at configured widths', async () => {
    fixture = await makeFixtureSite({
      sourceImages: {
        'logo.png': { width: 200, height: 200, ext: 'png' },
        'logo-320.webp': { width: 200, height: 200, ext: 'webp' },
      },
    });
    const config = { widths: [320, 640], formats: ['webp'] };
    const jobs = planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceKey).toBe('img/logo.png');
  });

  it('treats variant-shaped non-configured-width files as originals', async () => {
    fixture = await makeFixtureSite({
      sourceImages: { 'team-2024.jpg': { width: 1200, height: 800 } },
    });
    const config = { widths: [320, 640], formats: ['webp'] };
    const jobs = planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceKey).toBe('img/team-2024.jpg');
  });

  it('skips SVG files (no variant generation)', async () => {
    fixture = await makeFixtureSite({
      sourceImages: { 'hero.jpg': { width: 1600, height: 900 } },
    });
    // Create an SVG by hand
    const fs = await import('node:fs');
    fs.writeFileSync(path.join(fixture.imgDir, 'icon.svg'), '<svg/>');
    const config = { widths: [640], formats: ['webp'] };
    const jobs = planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceKey).toBe('img/hero.jpg');
  });

  it('skips files inside _source/ subdir (legacy convention)', async () => {
    fixture = await makeFixtureSite({
      sourceImages: { 'logo.png': { width: 200, height: 200, ext: 'png' } },
    });
    const fs = await import('node:fs');
    const sourceDir = path.join(fixture.imgDir, '_source');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'legacy.jpg'), Buffer.from([0]));
    const config = { widths: [640], formats: ['webp'] };
    const jobs = planVariantJobsFromFlatDir({ siteImgDir: fixture.imgDir, config });
    expect(jobs.map((j) => j.sourceKey)).toEqual(['img/logo.png']);
  });

  it('returns [] when siteImgDir is missing', () => {
    const config = { widths: [320], formats: ['webp'] };
    expect(planVariantJobsFromFlatDir({ siteImgDir: '/nonexistent/path', config })).toEqual([]);
  });
});
