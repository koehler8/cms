/**
 * Sharp-powered variant renderer. Reads a source image, resizes to the
 * requested width (clamped to source size — no enlargement), and writes
 * the encoded output to outPath.
 *
 * Pure function: takes paths and config, performs IO, returns nothing.
 * Sharp is imported lazily by the caller (see reconcile.js) so dev-mode
 * cold start doesn't pay sharp's native-binding load cost when there's
 * nothing to render.
 */

import fs from 'node:fs';
import path from 'node:path';

export async function renderOutput(sharp, sourcePath, output, config) {
  const { width, format, outPath } = output;
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  let pipeline = sharp(sourcePath, { failOn: 'truncated' }).rotate();
  pipeline = pipeline.resize({ width, withoutEnlargement: true });

  switch (format) {
    case 'avif':
      pipeline = pipeline.avif({ quality: config.quality.avif });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: config.quality.webp });
      break;
    case 'jpg':
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: config.quality.jpg, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png();
      break;
    default:
      throw new Error(`unsupported format: ${format}`);
  }

  await pipeline.toFile(outPath);
}
