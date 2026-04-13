#!/usr/bin/env node
// Wrapper that runs the framework's generate-public-assets.js from the
// consuming site repo's CWD. Accepts --site-dir <path> to locate site assets;
// defaults to ./site.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse --site-dir arg
const args = process.argv.slice(2);
let siteDir = './site';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--site-dir' && args[i + 1]) {
    siteDir = args[i + 1];
    i++;
  }
}

// Expose for the underlying script via env var
process.env.CMS_SITE_DIR = path.resolve(process.cwd(), siteDir);

// Resolve and import the actual script (it runs on import)
const scriptPath = path.resolve(__dirname, '..', 'scripts', 'generate-public-assets.js');
await import(pathToFileURL(scriptPath).href);
