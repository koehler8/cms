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

    const allCached = !configChanged
      && previous
      && previous.mtimeMs >= sourceMtime
      && job.outputs.every((o) => fs.existsSync(path.join(cacheDir, o.cacheRelPath)));

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

  for (const { job, sourceMtime, render } of plannedRenders) {
    if (!render) {
      skipped += job.outputs.length;
      continue;
    }
    for (const output of job.outputs) {
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

  const newManifest = {
    version: MANIFEST_VERSION,
    config: currentConfig,
    sources: {},
  };
  for (const { job, sourceMtime } of plannedRenders) {
    newManifest.sources[job.sourceKey] = {
      mtimeMs: sourceMtime,
      variants: job.outputs.map((o) => o.cacheRelPath),
    };
  }
  writeManifest(manifestPath, newManifest);

  if (generated || evicted) {
    log(`sources: ${jobs.length}, generated: ${generated}, skipped: ${skipped}, evicted: ${evicted}`);
  }

  return { generated, skipped, evicted };
}
