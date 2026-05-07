/**
 * Reconcile the variant cache directory against the planned jobs:
 *   - Generate variants whose source mtime is newer than cached, or whose
 *     cached file no longer exists, or when the config block has changed.
 *   - Skip jobs whose cached variants are all up-to-date.
 *   - Delete cached variants for sources that no longer exist (orphans).
 *   - Write the new manifest at the end.
 *
 * Sharp is imported lazily — only when there is actual rendering work to do.
 * This keeps dev-mode cold-start fast when the cache is fully populated.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readManifest, writeManifest, configsEqual, MANIFEST_VERSION } from './manifest.js';
import { renderOutput } from './renderer.js';

/**
 * @param {object} args
 * @param {Array} args.jobs - planVariantJobsFromFlatDir output
 * @param {string} args.cacheDir - absolute path to the variant cache root
 * @param {string} args.manifestPath - absolute path to .manifest.json
 * @param {{widths, formats, quality}} args.currentConfig
 * @param {(msg: string) => void} [args.log]
 * @returns {Promise<{generated: number, skipped: number, evicted: number}>}
 */
export async function reconcileVariantCache({
  jobs,
  cacheDir,
  manifestPath,
  currentConfig,
  log = () => {},
}) {
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const saved = readManifest(manifestPath);
  const configChanged = !saved || !configsEqual(saved.config, currentConfig);

  const currentSourceKeys = new Set(jobs.map((j) => j.sourceKey));

  let evicted = 0;
  if (saved) {
    for (const oldKey of Object.keys(saved.sources || {})) {
      if (currentSourceKeys.has(oldKey)) continue;
      const oldEntry = saved.sources[oldKey];
      for (const variantRel of (oldEntry.variants || [])) {
        const fullPath = path.join(cacheDir, variantRel);
        if (fs.existsSync(fullPath)) {
          await fs.promises.rm(fullPath, { force: true });
          evicted += 1;
        }
      }
    }
  }

  const plannedRenders = [];
  for (const job of jobs) {
    const previous = saved?.sources?.[job.sourceKey];
    let sourceMtime;
    try {
      sourceMtime = fs.statSync(job.sourcePath).mtimeMs;
    } catch {
      continue;
    }

    // Source is "cached" if the manifest knows it, mtime hasn't changed,
    // config hasn't changed, AND every variant the previous run wrote is
    // still on disk. We check `previous.variants` (what was actually
    // generated) rather than `job.outputs` (everything the planner asked
    // for) so tiny-source sites — where the renderer skipped over-large
    // widths to avoid Vite content-dedup — aren't perpetually re-rendered
    // on each build.
    const previousVariants = previous?.variants || [];
    const allCached = !configChanged
      && previous
      && previous.mtimeMs >= sourceMtime
      && previousVariants.every((v) => fs.existsSync(path.join(cacheDir, v)));

    if (allCached) {
      plannedRenders.push({ job, sourceMtime, render: false });
    } else {
      plannedRenders.push({ job, sourceMtime, render: true });
    }
  }

  const renderJobs = plannedRenders.filter((p) => p.render);

  let generated = 0;
  let skipped = 0;
  let sharp = null;

  if (renderJobs.length > 0) {
    const mod = await import('sharp');
    sharp = mod.default;
  }

  // Per-source: filter outputs to widths the source can actually fulfill.
  // Sharp's `withoutEnlargement: true` clamps oversize requests to the
  // source dimensions, producing content-identical files for every width
  // greater than the source. Vite content-hashes those files identically
  // and emits ONE physical asset under one of the names — but assetUrlMap
  // still has URL keys for every width, so requests for the deduped
  // higher-width URLs 404.
  //
  // Fix: only generate variants for widths < source.width. Plus, always
  // generate at exactly source.width (for crisp 1× display) by remapping
  // any single oversize width down to source.width if no smaller variant
  // would otherwise exist. The pipeline's natural fallback to the bare
  // `img/{name}.{ext}` URL (which exists because the original is in the
  // flat dir) covers tiny sources where no variant width fits.
  const filteredOutputsByJob = new Map();
  for (const { job } of plannedRenders) {
    let sourceWidth = Number.MAX_SAFE_INTEGER;
    if (sharp) {
      try {
        const meta = await sharp(job.sourcePath).metadata();
        if (meta && Number.isFinite(meta.width)) sourceWidth = meta.width;
      } catch {
        // If metadata read fails, fall through and render everything —
        // the failure is benign (just the dedup risk we're trying to avoid).
      }
    }
    const kept = job.outputs.filter((o) => o.width <= sourceWidth);
    filteredOutputsByJob.set(job.sourceKey, kept);
  }

  for (const { job, sourceMtime, render } of plannedRenders) {
    if (!render) {
      skipped += (filteredOutputsByJob.get(job.sourceKey) || job.outputs).length;
      continue;
    }
    const outputs = filteredOutputsByJob.get(job.sourceKey) || job.outputs;
    for (const output of outputs) {
      const outPath = path.join(cacheDir, output.cacheRelPath);
      try {
        await renderOutput(sharp, job.sourcePath, { ...output, outPath }, currentConfig);
        generated += 1;
      } catch (err) {
        log(`failed ${output.cacheRelPath}: ${err.message}`);
      }
    }
    void sourceMtime;
  }

  // Evict any cached variants that the source can no longer fulfill
  // (e.g. someone replaced a 4000px source with a 200px one — the
  // 1280/1920/2560 outputs from the previous run are now stale).
  for (const { job, render } of plannedRenders) {
    if (!render) continue;
    const kept = new Set((filteredOutputsByJob.get(job.sourceKey) || job.outputs).map((o) => o.cacheRelPath));
    for (const o of job.outputs) {
      if (kept.has(o.cacheRelPath)) continue;
      const stalePath = path.join(cacheDir, o.cacheRelPath);
      if (fs.existsSync(stalePath)) {
        await fs.promises.rm(stalePath, { force: true });
        evicted += 1;
      }
    }
  }

  const newManifest = {
    version: MANIFEST_VERSION,
    config: currentConfig,
    sources: {},
  };
  for (const { job, sourceMtime } of plannedRenders) {
    const outputs = filteredOutputsByJob.get(job.sourceKey) || job.outputs;
    newManifest.sources[job.sourceKey] = {
      mtimeMs: sourceMtime,
      variants: outputs.map((o) => o.cacheRelPath),
    };
  }
  writeManifest(manifestPath, newManifest);

  if (generated || evicted) {
    log(`sources: ${jobs.length}, generated: ${generated}, skipped: ${skipped}, evicted: ${evicted}`);
  }

  return { generated, skipped, evicted };
}
