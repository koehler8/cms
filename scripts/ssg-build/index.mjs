/**
 * cms-ssg-build — memory-bounded SSG pre-render (the durable fix for the
 * per-route heap accumulation in vite-ssg's single-process render; see
 * SSG-MEMORY-PLAN.md).
 *
 * vite-ssg renders every route in one Node process and leaves a fixed retained
 * cost per route, so peak heap scales with total routes (pages × locales) and
 * large sites OOM. This orchestrator runs the render as N separate
 * `vite-ssg build` processes, each handling a slice of the routes (via the
 * framework's CMS_SSG_SHARD hook) into its own outDir, then merges the shards
 * into dist/. Because each shard is its own process, memory is reclaimed
 * between shards — peak heap is bounded by SLICE size, not total routes,
 * independent of how large the site grows.
 *
 * Shards run sequentially by default: that gives the LOWEST peak memory (one
 * shard live at a time), which is the whole point. Parallelism would trade that
 * back for build speed and also races on the plugin's shared writes to the site
 * root, so it stays opt-in/experimental.
 *
 * Small sites (≤ one shard) fall through to a single ordinary `vite-ssg build`,
 * byte-identical to today.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findEmptyRenders } from './findEmptyRenders.mjs';

const CWD = process.cwd();
const TAG = '[cms-ssg-build]';

function parseArgs(argv) {
  const opts = {
    shardSize: 150, // routes per shard
    concurrency: 1, // sequential by default (lowest peak memory + no shared-write race)
    heap: 2048, // per-shard --max-old-space-size (MB); a slice fits comfortably
    siteDir: './site',
    passthrough: [], // forwarded verbatim to `vite-ssg build`
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shard-size') opts.shardSize = Number(argv[++i]) || opts.shardSize;
    else if (a === '--concurrency') opts.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--heap') opts.heap = Number(argv[++i]) || opts.heap;
    else if (a === '--site-dir') opts.siteDir = argv[++i] || opts.siteDir;
    else opts.passthrough.push(a);
  }
  return opts;
}

// Estimate the route count the same way the Vite plugin discovers routes
// (base-locale pages × content locales, + /404). Only used to choose
// the shard count N; the framework's CMS_SSG_SHARD filter partitions whatever
// routes actually exist, so an approximate N still yields a correct, complete
// dist/ — it just tunes slice sizes.
function estimateRouteCount(siteDir) {
  const contentDir = path.join(siteDir, 'content');
  let baseLocale = 'en';
  try {
    baseLocale = JSON.parse(fs.readFileSync(path.join(contentDir, 'content.config.json'), 'utf8')).baseLocale || 'en';
  } catch { /* default en */ }

  let pages = 1;
  try {
    pages = fs.readdirSync(path.join(contentDir, baseLocale, 'pages')).filter((f) => f.endsWith('.json')).length || 1;
  } catch { /* single page */ }

  let locales = 1;
  try {
    locales = fs.readdirSync(contentDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => {
        const dir = path.join(contentDir, d.name);
        return fs.existsSync(path.join(dir, 'site.json'))
          || fs.existsSync(path.join(dir, 'shared.json'))
          || fs.existsSync(path.join(dir, 'pages'));
      }).length || 1;
  } catch { /* single locale */ }

  return pages * locales + 1; // + /404
}

// Emitted by usePageConfig's SSR catch (see src/composables/usePageConfig.js).
// Its presence in a child's output means at least one route pre-rendered with
// no page content — a failure even when vite-ssg exits 0.
const CONFIG_FAIL_MARKER = 'PAGE CONFIG LOAD FAILED';

function resolveViteSsgBin() {
  const local = path.join(CWD, 'node_modules', '.bin', 'vite-ssg');
  return fs.existsSync(local) ? local : 'vite-ssg';
}

function runViteSsg({ shard, outDir, heap, passthrough }) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (shard) env.CMS_SSG_SHARD = shard;
    if (outDir) env.CMS_SSG_OUTDIR = outDir;
    // A shard renders a bounded slice, so a modest heap suffices — this is what
    // lets sites drop the 8 GB stop-loss flag. Strip any inherited
    // --max-old-space-size and set our own.
    const base = (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '').trim();
    env.NODE_OPTIONS = `${base} --max-old-space-size=${heap}`.trim();

    const child = spawn(resolveViteSsgBin(), ['build', ...passthrough], { cwd: CWD, env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (err) => resolve({ code: 1, out: String(err && err.stack ? err.stack : err) }));
  });
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// Union-merge every shard's output into dist/. Shared files (assets/, sitemap,
// robots, manifest, favicon, 404.html) are byte-identical across shards, and
// per-route HTML files are disjoint — so a plain overwrite-merge is a clean
// union. The ONE exception is dist/index.html: only the shard that rendered `/`
// produced the real home page; every other shard's client build left a
// hydration shell there. So after merging, restore the rendered home
// explicitly (identified by the data-server-rendered marker).
async function mergeShards(shardDirs, finalDist) {
  await fsp.rm(finalDist, { recursive: true, force: true });
  await fsp.mkdir(finalDist, { recursive: true });
  for (const dir of shardDirs) {
    await fsp.cp(dir, finalDist, { recursive: true, force: true });
  }

  let renderedHome = null;
  for (const dir of shardDirs) {
    try {
      const html = await fsp.readFile(path.join(dir, 'index.html'), 'utf8');
      if (html.includes('data-server-rendered="true"')) { renderedHome = html; break; }
    } catch { /* shard has no index.html */ }
  }
  if (renderedHome != null) {
    await fsp.writeFile(path.join(finalDist, 'index.html'), renderedHome, 'utf8');
    return true;
  }
  // A client-shell homepage is blank for crawlers and until JS boots — that
  // is a failed build, not a warning (the empty-root detector can't catch a
  // shell: it has no SSR comment node to match).
  console.error(`${TAG} no shard produced a server-rendered home page; dist/index.html would be a client shell.`);
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const siteDir = path.resolve(CWD, opts.siteDir);
  const estRoutes = estimateRouteCount(siteDir);
  const N = Math.max(1, Math.ceil(estRoutes / opts.shardSize));

  if (N <= 1) {
    console.log(`${TAG} ~${estRoutes} routes ≤ shard size ${opts.shardSize}: running a single vite-ssg build (no sharding needed).`);
    const r = await runViteSsg({ heap: opts.heap, passthrough: opts.passthrough });
    process.stdout.write(r.out);
    if (r.code === 0) {
      if (r.out.includes(CONFIG_FAIL_MARKER)) {
        console.error(`${TAG} build exited 0 but at least one route failed to load its page config during pre-render (see "${CONFIG_FAIL_MARKER}" above). Failing the build.`);
        process.exit(1);
      }
      const empties = await findEmptyRenders(path.join(CWD, 'dist'));
      if (empties.length) {
        console.error(`${TAG} build succeeded but ${empties.length} page(s) rendered with an empty body — a known intermittent SSR race (see findEmptyRenders in this file). Re-run the build:`);
        for (const f of empties) console.error(`${TAG}   - ${f}`);
        process.exit(1);
      }
    }
    process.exit(r.code);
  }

  console.log(`${TAG} ~${estRoutes} routes → ${N} shards of ≤${opts.shardSize}, ${opts.heap} MB heap each, ${opts.concurrency === 1 ? 'sequential' : `${opts.concurrency}-way parallel`}. Peak heap is bounded per shard.`);
  if (opts.concurrency > 1) {
    console.warn(`${TAG} warning: --concurrency > 1 is experimental — parallel shards race on the plugin's shared site-root writes AND on the shared image-variant cache (node_modules/.cache/@koehler8/cms/image-variants: concurrent evictions, duplicate renders, last-writer-wins manifest), and raise peak memory. Sequential is recommended.`);
  }

  const tmp = path.join(CWD, '.cms-ssg');
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });

  const shards = Array.from({ length: N }, (_, k) => ({ k, outDir: path.join('.cms-ssg', `dist-${k}`) }));
  const t0 = Date.now();
  const results = await pool(shards, opts.concurrency, async (s) => {
    const started = Date.now();
    process.stdout.write(`${TAG} shard ${s.k + 1}/${N} rendering…\n`);
    const r = await runViteSsg({ shard: `${s.k}/${N}`, outDir: s.outDir, heap: opts.heap, passthrough: opts.passthrough });
    let empties = [];
    const configFailed = r.code === 0 && r.out.includes(CONFIG_FAIL_MARKER);
    if (r.code === 0 && !configFailed) {
      empties = await findEmptyRenders(path.join(CWD, s.outDir));
    }
    const ok = r.code === 0 && !configFailed && empties.length === 0;
    process.stdout.write(`${TAG} shard ${s.k + 1}/${N} ${ok ? 'ok' : 'FAILED'} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
    if (configFailed) {
      return {
        ...r,
        code: 1,
        out: `${r.out}\n${TAG} at least one route failed to load its page config during pre-render ("${CONFIG_FAIL_MARKER}").\n`,
        k: s.k,
      };
    }
    if (empties.length) {
      return {
        ...r,
        code: 1,
        out: `${r.out}\n${TAG} ${empties.length} page(s) rendered with an empty body — a known intermittent SSR race (see findEmptyRenders in this file):\n${empties.map((f) => `  - ${f}`).join('\n')}\n`,
        k: s.k,
      };
    }
    return { ...r, k: s.k };
  });

  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    console.error(`${TAG} ${failed.length}/${N} shard(s) failed:`);
    for (const f of failed) {
      console.error(`${TAG} ---- shard ${f.k} output (tail) ----`);
      console.error(f.out.slice(-4000));
    }
    process.exit(1);
  }

  const homeOk = await mergeShards(shards.map((s) => path.join(CWD, s.outDir)), path.join(CWD, 'dist'));
  if (!homeOk) {
    process.exit(1);
  }
  // Belt-and-suspenders: re-check the merged output as a whole.
  const mergedEmpties = await findEmptyRenders(path.join(CWD, 'dist'));
  if (mergedEmpties.length) {
    console.error(`${TAG} merged dist/ contains ${mergedEmpties.length} empty-bodied page(s):`);
    for (const f of mergedEmpties) console.error(`${TAG}   - ${f}`);
    process.exit(1);
  }
  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`${TAG} merged ${N} shards → dist/ in ${((Date.now() - t0) / 1000).toFixed(1)}s. Done.`);
}

main().catch((err) => { console.error(TAG, err); process.exit(1); });
