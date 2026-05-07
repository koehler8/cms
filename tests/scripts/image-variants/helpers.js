import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Build a temp site fixture with originals in site/assets/img/ (flat dir).
 *
 * sourceImages keys are paths relative to site/assets/img/. Values are
 * { width, height, ext? } — sharp generates a solid-color placeholder.
 *
 *   sourceImages: {
 *     'logo.png': { width: 200, height: 200, ext: 'png' },
 *     'team/jamie.jpg': { width: 1600, height: 900 },
 *   }
 *
 * imageVariants is the optional `imageVariants` block written into
 * site.json — passes through to resolveImageVariantConfig.
 */
export async function makeFixtureSite({ sourceImages = {}, imageVariants } = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-iv-fixture-'));
  const siteDir = path.join(root, 'site');
  const imgDir = path.join(siteDir, 'assets', 'img');
  await fs.promises.mkdir(imgDir, { recursive: true });

  // Minimal content scaffolding so resolveSiteConfig works if a test calls it.
  const contentDir = path.join(siteDir, 'content');
  const enDir = path.join(contentDir, 'en');
  await fs.promises.mkdir(enDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(contentDir, 'content.config.json'),
    JSON.stringify({ baseLocale: 'en' }),
  );
  await fs.promises.writeFile(
    path.join(enDir, 'site.json'),
    JSON.stringify({ title: 'Fixture', ...(imageVariants ? { imageVariants } : {}) }),
  );

  // Render each source image as a solid color via sharp.
  for (const [relPath, spec] of Object.entries(sourceImages)) {
    const target = path.join(imgDir, relPath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const ext = (spec.ext || path.extname(relPath).replace(/^\./, '') || 'jpg').toLowerCase();
    let pipeline = sharp({
      create: {
        width: spec.width || 800,
        height: spec.height || 600,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    });
    if (ext === 'png') pipeline = pipeline.png();
    else if (ext === 'webp') pipeline = pipeline.webp();
    else if (ext === 'avif') pipeline = pipeline.avif();
    else pipeline = pipeline.jpeg();
    await pipeline.toFile(target);
  }

  return {
    root,
    siteDir,
    imgDir,
    cleanup: () => fs.promises.rm(root, { recursive: true, force: true }),
  };
}

export const noop = () => {};
