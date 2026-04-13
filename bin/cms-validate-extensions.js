#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
let siteDir = './site';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--site-dir' && args[i + 1]) {
    siteDir = args[i + 1];
    i++;
  }
}

process.env.CMS_SITE_DIR = path.resolve(process.cwd(), siteDir);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, '..', 'scripts', 'validate-extensions.mjs');
await import(pathToFileURL(scriptPath).href);
