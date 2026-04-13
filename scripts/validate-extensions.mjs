import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequire } from 'node:module';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
import { compareVersions } from '../src/utils/semver.js';
import { validateRequiredContentPaths } from '../src/utils/contentRequirements.js';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXTENSIONS_DIR = join(ROOT_DIR, 'extensions');
const SITES_DIR = join(ROOT_DIR, 'sites');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const APP_VERSION = process.env.VITE_APP_VERSION || packageJson.version || '0.0.0';
const normalizeSlug = (value) => (value || '').toString().trim().toLowerCase();

function isJsonFile(fileName) {
  return fileName.toLowerCase().endsWith('.json');
}

async function collectExtensionPackages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectExtensionPackages(absolute);
      packages.push(...nested);
      continue;
    }
    if (entry.name === 'extension.config.json') {
      packages.push(absolute);
    }
  }

  return packages;
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function loadExtensionRegistry() {
  const manifestPaths = await collectExtensionPackages(EXTENSIONS_DIR);
  const map = new Map();

  for (const manifestPath of manifestPaths) {
    const manifestDir = manifestPath.replace(/extension\.config\.json$/i, '');
    const manifest = await loadJson(manifestPath);
    const slug = manifest.slug || manifestDir;
    map.set(slug, {
      manifest,
      dir: manifestDir,
    });
  }

  return map;
}

async function importSchema(schemaPath) {
  if (!schemaPath) return null;
  const lower = schemaPath.toLowerCase();
  if (lower.endsWith('.json')) {
    const raw = await readFile(schemaPath, 'utf-8');
    return JSON.parse(raw);
  }
  const url = pathToFileURL(schemaPath).href;
  const module = await import(url);
  return module?.default ?? module;
}

function buildComponentMaps(extensionRegistry) {
  const componentMap = new Map();
  const extensionNameToSources = new Map();

  for (const { manifest, dir } of extensionRegistry.values()) {
    if (!Array.isArray(manifest.components)) continue;
    const slug = typeof manifest.slug === 'string' ? manifest.slug.trim() : '';
    const normalizedSlug = slug ? slug.toLowerCase() : '';

    for (const component of manifest.components) {
      if (!component?.name) continue;
      const entry = {
        manifest,
        dir,
        component,
        slug,
        normalizedSlug,
      };
      if (normalizedSlug) {
        const sourceKey = `${normalizedSlug}:${component.name}`;
        componentMap.set(sourceKey, entry);
        const existingSources = extensionNameToSources.get(component.name) || new Set();
        existingSources.add(normalizedSlug);
        extensionNameToSources.set(component.name, existingSources);
      }
    }
  }

  return {
    componentMap,
    extensionNameToSources,
  };
}

async function collectSiteConfigs(dir) {
  const configs = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectSiteConfigs(absolute);
      configs.push(...nested);
      continue;
    }
    if (isJsonFile(entry.name)) {
      configs.push(absolute);
    }
  }
  return configs;
}

async function validateConfigBlocks({
  siteConfigPath,
  siteConfig,
  componentMap,
  extensionNameToSources,
  appVersion,
}) {
  const failures = [];

  if (!siteConfig?.pages || typeof siteConfig.pages !== 'object') {
    return failures;
  }

  for (const [pageKey, pageConfig] of Object.entries(siteConfig.pages)) {
    if (!pageConfig || typeof pageConfig !== 'object') continue;
    const components = Array.isArray(pageConfig.components) ? pageConfig.components : [];
    const content = pageConfig.content && typeof pageConfig.content === 'object' ? pageConfig.content : {};
    const normalizedPageKey = (pageKey || '').toString().trim().toLowerCase();

    for (const entry of components) {
      let name = '';
      let configKeyOverride;
      let enabled = true;
      let source;

      if (typeof entry === 'string') {
        name = entry;
      } else if (entry && typeof entry === 'object') {
        enabled = entry.enabled !== false;
        name = typeof entry.name === 'string' ? entry.name : '';
        configKeyOverride = typeof entry.configKey === 'string' && entry.configKey.trim()
          ? entry.configKey.trim()
          : undefined;
        source = typeof entry.source === 'string' ? entry.source : undefined;
      } else {
        continue;
      }

      if (typeof name === 'string') {
        name = name.trim();
      }

      if (!enabled || !name) continue;

      const normalizedSource = source ? normalizeSlug(source) : '';
      const sourcesForName = extensionNameToSources.get(name);
      const isExtensionName = Boolean(sourcesForName && sourcesForName.size);

      if (isExtensionName && !normalizedSource) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          message: `Component comes from an extension and must specify "source". Available sources: ${Array.from(sourcesForName).join(', ')}`,
        });
        continue;
      }

      if (isExtensionName && normalizedSource && !sourcesForName.has(normalizedSource)) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          source: normalizedSource,
          message: `Component is not provided by the "${normalizedSource}" extension.`,
        });
        continue;
      }

      if (!isExtensionName && normalizedSource) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          source: normalizedSource,
          message: 'Component does not belong to an extension so "source" must be omitted.',
        });
        continue;
      }

      if (!isExtensionName) {
        continue;
      }

      const lookupKey = `${normalizedSource}:${name}`;
      const componentMeta = componentMap.get(lookupKey);
      if (!componentMeta) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          source: normalizedSource,
          message: 'Component metadata could not be resolved for the specified source.',
        });
        continue;
      }
      const { component, dir } = componentMeta;
      const configKey = configKeyOverride || component.configKey;
      if (!configKey) continue;
      const block = content[configKey];

      if (Array.isArray(component.allowedPages) && component.allowedPages.length) {
        const allowed = component.allowedPages
          .map((slug) => (slug || '').toString().trim().toLowerCase())
          .filter(Boolean);
        if (allowed.length && !allowed.includes(normalizedPageKey)) {
          failures.push({
            siteConfigPath,
            pageKey,
            componentName: name,
            configKey,
            source: normalizedSource || undefined,
            message: `Component is not allowed on this page (allowed: ${allowed.join(', ')}).`,
          });
          continue;
        }
      }

      if (component.minAppVersion && compareVersions(appVersion, component.minAppVersion) < 0) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          configKey,
          source: normalizedSource || undefined,
          message: `Component requires app version ${component.minAppVersion} or higher (current ${appVersion}).`,
        });
        continue;
      }

      if (Array.isArray(component.requiredContent) && component.requiredContent.length) {
        const { isValid, missing } = validateRequiredContentPaths(block, component.requiredContent);
        if (!isValid) {
          failures.push({
            siteConfigPath,
            pageKey,
            componentName: name,
            configKey,
            source: normalizedSource || undefined,
            message: `Missing required content paths: ${missing.join(', ')}`,
          });
          continue;
        }
      }

      const schemaRef = component.propsInterface;
      if (!schemaRef) continue;

      const schemaPath = join(dir, schemaRef.replace(/^\.\/+/, ''));
      let schema;
      let importFailed = false;
      try {
        schema = await importSchema(schemaPath);
      } catch (error) {
        importFailed = true;
        if (!(/Cannot use import statement/.test(String(error)) || /Unexpected reserved word/.test(String(error)))) {
          throw error;
        }
      }
      if (importFailed) {
        schema = await loadJson(schemaPath);
      }
      if (!schema) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          configKey,
          source: normalizedSource || undefined,
          message: `Schema "${schemaRef}" could not be loaded.`,
        });
        continue;
      }

      const validate = ajv.compile(schema);
      const valid = validate(block);
      if (!valid) {
        failures.push({
          siteConfigPath,
          pageKey,
          componentName: name,
          configKey,
          source: normalizedSource || undefined,
          errors: validate.errors,
        });
      }
    }
  }

  return failures;
}

async function main() {
  const extensionRegistry = await loadExtensionRegistry();
  if (!extensionRegistry.size) {
    console.warn('No extension manifests found under /extensions.');
    return;
  }
  const { componentMap, extensionNameToSources } = buildComponentMaps(extensionRegistry);

  const siteConfigs = await collectSiteConfigs(SITES_DIR);
  const failures = [];

  for (const siteConfigPath of siteConfigs) {
    let siteConfig;
    try {
      siteConfig = await loadJson(siteConfigPath);
    } catch (error) {
      failures.push({
        siteConfigPath,
        message: `Failed to parse JSON: ${error.message}`,
      });
      continue;
    }
    const blockFailures = await validateConfigBlocks({
      siteConfigPath,
      siteConfig,
      componentMap,
      extensionNameToSources,
      appVersion: APP_VERSION,
    });
    failures.push(...blockFailures);
  }

  if (failures.length) {
    console.error('Extension content validation failed:');
    failures.forEach((failure) => {
      console.error(`\n- ${failure.siteConfigPath}`);
      if (failure.pageKey) {
        console.error(`  Page: ${failure.pageKey}`);
      }
      if (failure.componentName) {
        console.error(`  Component: ${failure.componentName}`);
      }
      if (failure.source) {
        console.error(`  Source: ${failure.source}`);
      }
      if (failure.configKey) {
        console.error(`  Config key: ${failure.configKey}`);
      }
      if (failure.message) {
        console.error(`  Error: ${failure.message}`);
      }
      if (failure.errors) {
        failure.errors.forEach((error) => {
          console.error(`  • ${error.instancePath || '/'} ${error.message}`);
        });
      }
    });
    process.exitCode = 1;
    return;
  }

  console.log('All extension content blocks validated successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
