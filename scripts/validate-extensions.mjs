/**
 * cms-validate-extensions — validate a SITE's extension manifests.
 *
 * Validates, against the framework's JSON Schema (the same validation the
 * Vite plugin runs at build time):
 *   - every site-local extension at <projectRoot>/extensions/<slug>/
 *   - any extension package names passed as positional arguments
 *     (e.g. `cms-validate-extensions @koehler8/cms-ext-compliance`)
 *
 * The project root is the parent of --site-dir (default ./site), matching
 * how the Vite plugin resolves it. Exits non-zero on any invalid manifest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateExtensionManifests } from './lib/extension-manifests.mjs';

const siteDir = process.env.CMS_SITE_DIR
  ? path.resolve(process.env.CMS_SITE_DIR)
  : path.resolve(process.cwd(), './site');
const projectRoot = path.dirname(siteDir);

const packageSpecs = (process.env.CMS_VALIDATE_PACKAGES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const localSpecs = [];
const localExtensionsDir = path.join(projectRoot, 'extensions');
if (fs.existsSync(localExtensionsDir)) {
  for (const entry of fs.readdirSync(localExtensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(localExtensionsDir, entry.name, 'extension.config.json'))) {
      localSpecs.push(`./extensions/${entry.name}`);
    }
  }
}

const specs = [...localSpecs, ...packageSpecs];

if (specs.length === 0) {
  console.log(`No extension manifests found (looked in ${localExtensionsDir}, no packages named).`);
  console.log('Nothing to validate. Pass package names as arguments to check installed extensions.');
  process.exit(0);
}

try {
  const validated = await validateExtensionManifests(specs, projectRoot);
  for (const { spec, slug, componentNames } of validated) {
    console.log(`✓ ${spec} (slug "${slug}", ${componentNames.size} component${componentNames.size === 1 ? '' : 's'})`);
  }
  const skipped = specs.length - validated.length;
  if (skipped > 0) {
    console.warn(`⚠ ${skipped} spec(s) had no extension.config.json to validate (see warnings above).`);
  }
  console.log('\nAll extension manifests validated successfully.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
