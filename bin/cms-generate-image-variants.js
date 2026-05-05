#!/usr/bin/env node
// Wrapper that runs the framework's generate-image-variants.js from the
// consuming site repo's CWD. Accepts --site-dir <path> to locate site assets;
// defaults to ./site.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
let siteDir = './site';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--site-dir' && args[i + 1]) {
    siteDir = args[i + 1];
    i++;
  }
}

const resolvedSiteDir = path.resolve(process.cwd(), siteDir);
process.env.CMS_SITE_DIR = resolvedSiteDir;

const { generateVariants } = await import(
  path.resolve(__dirname, '..', 'scripts', 'generate-image-variants.js')
);

try {
  await generateVariants({ siteDir: resolvedSiteDir });
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
