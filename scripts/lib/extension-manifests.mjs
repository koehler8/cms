import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// framework root = two levels up from scripts/lib/
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Build-time extension-manifest validation. Manifests are static JSON, fixed
// at build time, so full JSON-Schema validation happens here — failing the
// build loudly — instead of shipping ajv to every visitor's browser (the
// runtime loader keeps only cheap structural checks). Spec resolution mirrors
// how the generated entry imports each extension: './'-relative specs resolve
// from the project root, package names from the project's node_modules.
// Exported for tests.
export async function validateExtensionManifests(extensionPackages, projectRoot, frameworkDir = FRAMEWORK_ROOT) {
  if (!Array.isArray(extensionPackages) || extensionPackages.length === 0) return [];

  const [{ default: Ajv }, ajvFormats] = await Promise.all([
    import('ajv/dist/2020.js'),
    import('ajv-formats'),
  ]);
  const addFormats = ajvFormats.default || ajvFormats;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaPath = path.join(frameworkDir, 'extensions', 'manifest.schema.json');
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf-8')));

  const problems = [];
  const manifests = [];
  for (const spec of extensionPackages) {
    const baseDir = spec.startsWith('.') || path.isAbsolute(spec)
      ? path.resolve(projectRoot, spec)
      : path.join(projectRoot, 'node_modules', ...spec.split('/'));
    const manifestPath = path.join(baseDir, 'extension.config.json');

    if (!fs.existsSync(manifestPath)) {
      // A spec may legitimately carry its manifest elsewhere (the entry
      // module imports it); the runtime structural check still covers it.
      console.warn(`[@koehler8/cms] extension "${spec}": no extension.config.json at ${manifestPath} — skipping build-time schema validation.`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      problems.push(`- ${spec}: extension.config.json is not valid JSON (${err.message})`);
      continue;
    }
    if (!validate(manifest)) {
      const details = (validate.errors || [])
        .map((e) => `    ${e.instancePath || '(root)'} ${e.message}`)
        .join('\n');
      problems.push(`- ${spec}: manifest failed schema validation\n${details}`);
      continue;
    }
    manifests.push({
      spec,
      slug: manifest.slug,
      componentNames: new Set(
        (manifest.components || []).map((c) => c && c.name).filter(Boolean),
      ),
    });
  }

  if (problems.length) {
    throw new Error(`[@koehler8/cms] Extension manifest validation failed:\n${problems.join('\n')}`);
  }
  return manifests;
}
