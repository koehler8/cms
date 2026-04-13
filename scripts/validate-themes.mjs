import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateThemeManifest } from '../src/themes/themeValidator.js';

const MANIFEST_PATTERN = /theme\.config\.(js|mjs|json)$/;
const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const THEMES_DIR = join(ROOT_DIR, 'themes');

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
  const manifestPaths = await collectManifestPaths(THEMES_DIR);
  if (!manifestPaths.length) {
    console.warn('No theme manifests found under /themes.');
    return;
  }
  const failures = [];
  for (const manifestPath of manifestPaths) {
    const manifest = await loadManifestFromPath(manifestPath);
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
