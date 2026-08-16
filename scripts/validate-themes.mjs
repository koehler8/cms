/**
 * cms-validate-themes — validate theme manifests.
 *
 * Validates:
 *   - the framework's bundled themes (themes/ at the package root)
 *   - a site's local themes at <projectRoot>/themes/<slug>/ when --site-dir
 *     is given (project root = parent of the site dir, matching the plugin)
 *
 * Exits non-zero on any invalid manifest.
 */

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateThemeManifest } from '../src/themes/themeValidator.js';

const MANIFEST_PATTERN = /theme\.config\.(js|mjs|json)$/;
const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FRAMEWORK_THEMES_DIR = join(ROOT_DIR, 'themes');

const siteDir = process.env.CMS_SITE_DIR ? resolve(process.env.CMS_SITE_DIR) : '';
const SITE_THEMES_DIR = siteDir ? join(dirname(siteDir), 'themes') : '';

async function collectManifestPaths(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectManifestPaths(absolutePath);
      paths.push(...nested);
    } else if (MANIFEST_PATTERN.test(entry.name)) {
      paths.push(absolutePath);
    }
  }
  return paths;
}

async function loadManifestFromPath(filePath) {
  const module = await import(pathToFileURL(filePath).href);
  return module?.default ?? module;
}

async function main() {
  const seen = new Set();
  const manifestPaths = [];
  for (const dir of [FRAMEWORK_THEMES_DIR, SITE_THEMES_DIR]) {
    if (!dir || !existsSync(dir)) continue;
    for (const p of await collectManifestPaths(dir)) {
      if (seen.has(p)) continue;
      seen.add(p);
      manifestPaths.push(p);
    }
  }

  if (!manifestPaths.length) {
    console.log('No theme manifests found (framework themes/ and site themes/ are both empty).');
    return;
  }

  const failures = [];
  for (const manifestPath of manifestPaths) {
    let manifest;
    try {
      manifest = await loadManifestFromPath(manifestPath);
    } catch (error) {
      failures.push({ path: manifestPath, errors: [`failed to load: ${error.message}`] });
      continue;
    }
    const { valid, errors } = validateThemeManifest(manifest, { throwOnError: false });
    if (!valid) {
      failures.push({ path: manifestPath, errors });
    } else {
      console.log(`✓ ${manifest.slug || manifestPath}`);
    }
  }

  if (failures.length) {
    console.error('\nTheme manifest validation failed:');
    failures.forEach(({ path, errors }) => {
      console.error(`\n- ${path}`);
      errors.forEach((error) => console.error(`  • ${error}`));
    });
    process.exitCode = 1;
    return;
  }

  console.log('\nAll theme manifests validated successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
