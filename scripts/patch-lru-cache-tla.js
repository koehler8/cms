#!/usr/bin/env node
/**
 * Patches all nested lru-cache copies in node_modules to remove top-level
 * await, which breaks Node 20's sync CJS loader when cssstyle (via jsdom, via
 * vite-ssg) tries to `require()` @asamuzakjp/css-color.
 *
 * The fix:
 *  1. Overwrite `dist/esm/diagnostics-channel.js` with a TLA-free no-op that
 *     uses createRequire() for node:diagnostics_channel.
 *  2. Rewrite each nested lru-cache `package.json` to point the `import`
 *     conditional at `dist/esm/index.js` (non-minified), which imports from
 *     our patched `diagnostics-channel.js` instead of inlining TLA.
 *
 * Safe to run repeatedly; idempotent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prefer INIT_CWD (set by npm during postinstall to the consumer's project
// root). Fall back to the parent of scripts/ (package root) or CWD.
const candidateRoots = [
  process.env.INIT_CWD,
  path.resolve(__dirname, '..'),
  process.cwd(),
].filter(Boolean);

let repoRoot;
let nodeModules;
for (const root of candidateRoots) {
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) {
    repoRoot = root;
    nodeModules = nm;
    break;
  }
}

if (!nodeModules) {
  console.log('[patch-lru-cache-tla] node_modules not found; skipping');
  process.exit(0);
}

const REPLACEMENT = `// Patched by scripts/patch-lru-cache-tla.js — removes top-level await.
// Uses createRequire to load node:diagnostics_channel synchronously from ESM.
import { createRequire } from 'node:module';
const dummy = { hasSubscribers: false };
let _metrics = dummy;
let _tracing = dummy;
try {
    const require = createRequire(import.meta.url);
    const dc = require('node:diagnostics_channel');
    _metrics = dc.channel('lru-cache:metrics');
    _tracing = dc.tracingChannel('lru-cache');
} catch {
    /* non-node runtime: keep dummy */
}
export const metrics = _metrics;
export const tracing = _tracing;
`;

function findLruCacheDirs(root) {
  const found = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'lru-cache' && fs.existsSync(path.join(full, 'package.json'))) {
        found.push(full);
        // don't recurse into lru-cache's own node_modules
        continue;
      }
      if (entry.name === 'node_modules' || entry.name.startsWith('@')) {
        walk(full);
      } else if (entry.name === 'node_modules') {
        walk(full);
      } else {
        // Only recurse into scoped/package dirs that could contain nested node_modules
        const nested = path.join(full, 'node_modules');
        if (fs.existsSync(nested)) walk(nested);
      }
    }
  }
  walk(root);
  return found;
}

function patchLruCache(lruDir) {
  const diagFile = path.join(lruDir, 'dist', 'esm', 'diagnostics-channel.js');
  const pkgFile = path.join(lruDir, 'package.json');
  const indexJs = path.join(lruDir, 'dist', 'esm', 'index.js');

  if (!fs.existsSync(diagFile) || !fs.existsSync(pkgFile) || !fs.existsSync(indexJs)) {
    return false;
  }

  let patched = false;

  // 1. Overwrite diagnostics-channel.js if it still contains TLA
  const current = fs.readFileSync(diagFile, 'utf-8');
  if (current.includes('await import')) {
    fs.writeFileSync(diagFile, REPLACEMENT, 'utf-8');
    patched = true;
  }

  // 2. Rewrite package.json exports to use non-minified index.js
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
  let pkgChanged = false;

  const rewriteExports = (exports) => {
    if (!exports || typeof exports !== 'object') return;
    for (const key of Object.keys(exports)) {
      const value = exports[key];
      if (value && typeof value === 'object') {
        if (value.import && typeof value.import === 'object' && value.import.default) {
          if (value.import.default.includes('index.min.js')) {
            value.import.default = value.import.default.replace('index.min.js', 'index.js');
            pkgChanged = true;
          }
        } else if (typeof value.import === 'string' && value.import.includes('index.min.js')) {
          value.import = value.import.replace('index.min.js', 'index.js');
          pkgChanged = true;
        }
        rewriteExports(value);
      }
    }
  };

  rewriteExports(pkg.exports);

  if (pkg.module && pkg.module.includes('index.min.js')) {
    pkg.module = pkg.module.replace('index.min.js', 'index.js');
    pkgChanged = true;
  }

  if (pkgChanged) {
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    patched = true;
  }

  return patched;
}

const lruDirs = findLruCacheDirs(nodeModules);
let patchedCount = 0;
for (const dir of lruDirs) {
  if (patchLruCache(dir)) {
    patchedCount++;
    console.log(`[patch-lru-cache-tla] patched ${path.relative(repoRoot, dir)}`);
  }
}

console.log(
  `[patch-lru-cache-tla] processed ${lruDirs.length} lru-cache dirs, patched ${patchedCount}`
);
