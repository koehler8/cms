import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

import {
  generateVariants,
  resolveImageVariantConfig,
  planVariantJobs,
} from '../../scripts/generate-image-variants.js';

const noop = () => {};

async function makeFixtureSite({
  baseLocale = 'en',
  imageVariants,
  sourceImages = {},
} = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-img-variants-'));
  const siteDir = path.join(root, 'site');

  // content.config.json + minimal site.json
  const contentDir = path.join(siteDir, 'content');
  await fs.promises.mkdir(path.join(contentDir, baseLocale), { recursive: true });
  await fs.promises.writeFile(
    path.join(contentDir, 'content.config.json'),
    JSON.stringify({ baseLocale }),
  );
  const siteJson = { title: 'Fixture' };
  if (imageVariants) siteJson.imageVariants = imageVariants;
  await fs.promises.writeFile(
    path.join(contentDir, baseLocale, 'site.json'),
    JSON.stringify(siteJson),
  );

  // Source images
  const sourceDir = path.join(siteDir, 'assets', 'img', '_source');
  await fs.promises.mkdir(sourceDir, { recursive: true });
  for (const [relName, opts] of Object.entries(sourceImages)) {
    const fullPath = path.join(sourceDir, relName);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    const buf = await sharp({
      create: {
        width: opts.width || 800,
        height: opts.height || 600,
        channels: 3,
        background: opts.background || '#ff0000',
      },
    })
      .toFormat('jpeg')
      .toBuffer();
    await fs.promises.writeFile(fullPath, buf);
  }

  return { root, siteDir };
}

describe('resolveImageVariantConfig', () => {
  it('returns sane defaults for an empty config', () => {
    const config = resolveImageVariantConfig({});
    expect(config.widths).toEqual([320, 640, 960, 1280, 1920, 2560]);
    expect(config.formats).toEqual(['avif', 'webp', 'jpg']);
    expect(config.quality.avif).toBeGreaterThan(0);
  });

  it('respects custom widths', () => {
    const config = resolveImageVariantConfig({ imageVariants: { widths: [640, 1280] } });
    expect(config.widths).toEqual([640, 1280]);
  });

  it('drops invalid widths and de-dupes', () => {
    const config = resolveImageVariantConfig({
      imageVariants: { widths: [640, 1280, 1280, 'not-a-number', -1] },
    });
    expect(config.widths).toEqual([640, 1280]);
  });

  it('falls back to defaults when all widths are invalid', () => {
    const config = resolveImageVariantConfig({
      imageVariants: { widths: ['nope', null] },
    });
    expect(config.widths).toEqual([320, 640, 960, 1280, 1920, 2560]);
  });

  it('respects custom formats', () => {
    const config = resolveImageVariantConfig({ imageVariants: { formats: ['avif'] } });
    expect(config.formats).toEqual(['avif']);
  });

  it('drops unsupported formats', () => {
    const config = resolveImageVariantConfig({
      imageVariants: { formats: ['avif', 'gif', 'tiff', 'webp'] },
    });
    expect(config.formats).toEqual(['avif', 'webp']);
  });

  it('clamps quality values', () => {
    const config = resolveImageVariantConfig({
      imageVariants: { quality: { avif: 999, webp: -10, jpg: 50 } },
    });
    expect(config.quality.jpg).toBe(50);
    // out-of-range values fall back to default
    expect(config.quality.avif).toBe(60);
    expect(config.quality.webp).toBe(75);
  });
});

describe('planVariantJobs', () => {
  let fixture;

  beforeEach(async () => {
    fixture = await makeFixtureSite({
      sourceImages: { 'hero.jpg': { width: 1600, height: 900 } },
    });
  });

  afterEach(async () => {
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  });

  it('plans width × format jobs for one source plus a source copy', () => {
    const config = { widths: [640, 1280], formats: ['avif', 'webp'], quality: {} };
    const jobs = planVariantJobs({ siteDir: fixture.siteDir, config });
    expect(jobs).toHaveLength(1);
    // 1 source copy + (2 widths × 2 formats) = 5 outputs.
    expect(jobs[0].outputs).toHaveLength(5);
    expect(jobs[0].outputs.map((o) => path.basename(o.outPath))).toEqual([
      'hero.jpg',
      'hero-640.avif',
      'hero-640.webp',
      'hero-1280.avif',
      'hero-1280.webp',
    ]);
    expect(jobs[0].outputs[0].kind).toBe('copy');
    expect(jobs[0].outputs[1].kind).toBe('variant');
  });

  it('handles subdirectories under _source', async () => {
    const subFixture = await makeFixtureSite({
      sourceImages: { 'team/jamie.jpg': { width: 1200, height: 1200 } },
    });
    try {
      const config = { widths: [640], formats: ['avif'], quality: {} };
      const jobs = planVariantJobs({ siteDir: subFixture.siteDir, config });
      expect(jobs).toHaveLength(1);
      const variantOutput = jobs[0].outputs.find((o) => o.kind === 'variant');
      const copyOutput = jobs[0].outputs.find((o) => o.kind === 'copy');
      expect(variantOutput.outPath).toContain(path.join('img', 'team', 'jamie-640.avif'));
      expect(copyOutput.outPath).toContain(path.join('img', 'team', 'jamie.jpg'));
    } finally {
      await fs.promises.rm(subFixture.root, { recursive: true, force: true });
    }
  });

  it('returns [] when _source dir is missing', async () => {
    const empty = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-empty-'));
    const siteDir = path.join(empty, 'site');
    await fs.promises.mkdir(siteDir, { recursive: true });
    try {
      const config = { widths: [640], formats: ['avif'], quality: {} };
      expect(planVariantJobs({ siteDir, config })).toEqual([]);
    } finally {
      await fs.promises.rm(empty, { recursive: true, force: true });
    }
  });

  it('skips non-image files in _source', async () => {
    await fs.promises.writeFile(
      path.join(fixture.siteDir, 'assets', 'img', '_source', 'README.md'),
      '# notes',
    );
    const config = { widths: [640], formats: ['avif'], quality: {} };
    const jobs = planVariantJobs({ siteDir: fixture.siteDir, config });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourcePath).toContain('hero.jpg');
  });
});

describe('generateVariants', () => {
  let fixture;

  beforeEach(async () => {
    fixture = await makeFixtureSite({
      imageVariants: { widths: [320, 640], formats: ['avif', 'webp', 'jpg'] },
      sourceImages: { 'hero.jpg': { width: 1600, height: 900 } },
    });
  });

  afterEach(async () => {
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  });

  it('generates the full matrix on a clean run', async () => {
    const result = await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    expect(result.sources).toBe(1);
    // 2 widths × 3 formats = 6 variants, plus 1 source copy.
    expect(result.generated).toBe(7);
    expect(result.skipped).toBe(0);

    const imgDir = path.join(fixture.siteDir, 'assets', 'img');
    expect(fs.existsSync(path.join(imgDir, 'hero.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(imgDir, 'hero-320.avif'))).toBe(true);
    expect(fs.existsSync(path.join(imgDir, 'hero-320.webp'))).toBe(true);
    expect(fs.existsSync(path.join(imgDir, 'hero-320.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(imgDir, 'hero-640.avif'))).toBe(true);
    expect(fs.existsSync(path.join(imgDir, 'hero-640.webp'))).toBe(true);
    expect(fs.existsSync(path.join(imgDir, 'hero-640.jpg'))).toBe(true);
  });

  it('copies the source file to the flat dir with byte-identical content', async () => {
    await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    const sourcePath = path.join(fixture.siteDir, 'assets', 'img', '_source', 'hero.jpg');
    const copyPath = path.join(fixture.siteDir, 'assets', 'img', 'hero.jpg');
    const sourceBuf = await fs.promises.readFile(sourcePath);
    const copyBuf = await fs.promises.readFile(copyPath);
    expect(copyBuf.equals(sourceBuf)).toBe(true);
  });

  it('skips up-to-date variants on re-run', async () => {
    await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    const result = await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(7);
  });

  it('regenerates when source mtime is newer', async () => {
    await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    // Bump source mtime to "now + 1s" so it's strictly newer than outputs.
    const sourcePath = path.join(fixture.siteDir, 'assets', 'img', '_source', 'hero.jpg');
    const future = new Date(Date.now() + 1000);
    fs.utimesSync(sourcePath, future, future);

    const result = await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    expect(result.generated).toBe(7);
    expect(result.skipped).toBe(0);
  });

  it('produces correctly-resized output files', async () => {
    await generateVariants({ siteDir: fixture.siteDir, log: noop, warn: noop });
    const meta = await sharp(
      path.join(fixture.siteDir, 'assets', 'img', 'hero-640.webp'),
    ).metadata();
    expect(meta.width).toBe(640);
    // Source was 1600×900 (16:9), so resized 640×N preserves the ratio.
    expect(meta.height).toBe(360);
  });

  it('does NOT enlarge sources smaller than the requested width', async () => {
    const smallFixture = await makeFixtureSite({
      imageVariants: { widths: [640, 1920], formats: ['webp'] },
      sourceImages: { 'tiny.jpg': { width: 200, height: 150 } },
    });
    try {
      await generateVariants({ siteDir: smallFixture.siteDir, log: noop, warn: noop });
      const a = await sharp(
        path.join(smallFixture.siteDir, 'assets', 'img', 'tiny-640.webp'),
      ).metadata();
      const b = await sharp(
        path.join(smallFixture.siteDir, 'assets', 'img', 'tiny-1920.webp'),
      ).metadata();
      // Both clamped to original 200px width.
      expect(a.width).toBe(200);
      expect(b.width).toBe(200);
    } finally {
      await fs.promises.rm(smallFixture.root, { recursive: true, force: true });
    }
  });

  it('returns 0/0/0 when _source is empty', async () => {
    const empty = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-empty-'));
    const siteDir = path.join(empty, 'site');
    await fs.promises.mkdir(path.join(siteDir, 'content', 'en'), { recursive: true });
    await fs.promises.writeFile(
      path.join(siteDir, 'content', 'content.config.json'),
      JSON.stringify({ baseLocale: 'en' }),
    );
    await fs.promises.writeFile(
      path.join(siteDir, 'content', 'en', 'site.json'),
      JSON.stringify({}),
    );
    try {
      const result = await generateVariants({ siteDir, log: noop, warn: noop });
      expect(result).toEqual({ generated: 0, skipped: 0, sources: 0 });
    } finally {
      await fs.promises.rm(empty, { recursive: true, force: true });
    }
  });

  it('throws when siteDir does not exist', async () => {
    await expect(
      generateVariants({ siteDir: '/nonexistent/path/that/does/not/exist' }),
    ).rejects.toThrow(/siteDir does not exist/);
  });
});
