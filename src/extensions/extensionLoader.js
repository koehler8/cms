import { defineAsyncComponent } from 'vue';

import manifestSchema from '../../extensions/manifest.schema.json';
import { unwrapDefault as toPlainModule } from '../utils/unwrapDefault.js';

const manifestModules = import.meta.glob('../../extensions/**/extension.config.json', {
  eager: true,
});

const contentDefaultModules = import.meta.glob('../../extensions/**/content.defaults.json', {
  eager: true,
});

const entryModules = import.meta.glob([
  '../../extensions/**/*.{js,ts,mjs,cjs}',
  '!../../extensions/**/tests/**',
  '!**/*.spec.*',
]);

const componentModules = import.meta.glob([
  '../../extensions/**/*.{vue,js,ts,mjs,cjs}',
  '!../../extensions/**/tests/**',
  '!**/*.spec.*',
]);

// Lazy-load ajv via dynamic import — the static `import Ajv from 'ajv/...'`
// fails when Vite serves this file outside the dep optimizer (CJS module
// without a default export shim).  Dynamic import always gets the shim.
let validateManifest;
async function getValidator() {
  if (!validateManifest) {
    const [{ default: Ajv }, ajvFormats] = await Promise.all([
      import('ajv/dist/2020'),
      import('ajv-formats'),
    ]);
    const addFormats = ajvFormats.default || ajvFormats;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validateManifest = ajv.compile(manifestSchema);
  }
  return validateManifest;
}

const extensionComponentRegistry = {};
const extensionComponentRegistryBySource = {};
const extensionComponentSourcesByName = {};
const extensionComponentCatalog = [];
const extensionContentDefaults = {};
const extensionSetupFns = [];

const DEV = import.meta.env.DEV;

const warn = (...args) => {
  if (DEV) {
    console.warn('[extensions]', ...args);
  }
};

const resolveEntryPath = (manifestPath, entryPath) => {
  if (!manifestPath || !entryPath) return null;
  const normalizedEntry = entryPath.replace(/^\.\/+/, '');
  if (!normalizedEntry) return null;
  const manifestDir = manifestPath.replace(/extension\.config\.json$/i, '');
  return `${manifestDir}${normalizedEntry}`;
};

const registerComponentMeta = (args) => {
  extensionComponentCatalog.push({
    name: args.name,
    description: args.description || '',
    configKey: args.configKey,
    allowedPages: Array.isArray(args.allowedPages) && args.allowedPages.length
      ? [...args.allowedPages]
      : null,
    propsInterface: args.propsInterface || null,
    requiredContent: Array.isArray(args.requiredContent) && args.requiredContent.length
      ? [...args.requiredContent]
      : null,
    minAppVersion: args.minAppVersion || null,
    extension: {
      slug: args.slug,
      version: args.version,
      provider: args.provider,
    },
  });
};

const createAsyncComponent = (loader, context) => {
  return defineAsyncComponent(async () => {
    try {
      const mod = await loader();
      const component = toPlainModule(mod);
      if (!component) {
        throw new Error(`Module did not export a usable component.`);
      }
      return component;
    } catch (error) {
      warn(
        `Failed to load component module "${context?.componentName || ''}" from "${context?.slug || 'unknown'}".`,
        error,
      );
      throw error;
    }
  });
};

const resolveComponentModule = (manifestPath, modulePath = '', context = {}) => {
  if (!modulePath) return null;
  const normalizedModule = modulePath.replace(/^\.\/+/, '');
  if (!normalizedModule) return null;
  const manifestDir = manifestPath.replace(/extension\.config\.json$/i, '');
  const fullPath = `${manifestDir}${normalizedModule}`;
  const loader = componentModules[fullPath];
  if (!loader) {
    warn(`Module "${modulePath}" declared in manifest "${context?.slug || 'unknown'}" could not be found.`);
    return null;
  }
  return createAsyncComponent(loader, context);
};

const manifestEntries = Object.entries(manifestModules);

await Promise.all(
  manifestEntries.map(async ([manifestPath, module]) => {
    const manifest = toPlainModule(module);
    if (!manifest) {
      warn(`Manifest at ${manifestPath} did not export a value.`);
      return;
    }

    const validate = await getValidator();
    const isValid = validate(manifest);
    if (!isValid) {
      warn(`Manifest at ${manifestPath} failed validation.`, validate.errors);
      return;
    }

    const needsEntry = manifest.components.some((component) => !component?.module);
    let exportedComponents = {};

    if (needsEntry) {
      const entryPath = resolveEntryPath(manifestPath, manifest.entry);
      if (!entryPath) {
        warn(`Manifest "${manifest.slug}" is missing a valid entry file.`);
        return;
      }

      const entryLoader = entryModules[entryPath];
      if (!entryLoader) {
        warn(`Entry file "${entryPath}" for manifest "${manifest.slug}" could not be found.`);
        return;
      }

      let entryModule;
      try {
        entryModule = await entryLoader();
      } catch (error) {
        warn(`Entry module "${entryPath}" for manifest "${manifest.slug}" failed to load.`, error);
        return;
      }

      let entry = toPlainModule(entryModule);
      if (typeof entry === 'function') {
        try {
          entry = entry();
        } catch (error) {
          warn(`Entry module "${entryPath}" threw during execution.`, error);
          return;
        }
      }
      if (!entry) {
        warn(`Entry module "${entryPath}" did not export anything usable.`);
        return;
      }

      exportedComponents = entry.components && typeof entry.components === 'object'
        ? entry.components
        : entry;

      if (!exportedComponents || typeof exportedComponents !== 'object') {
        warn(`Entry module "${entryPath}" must export a components object.`);
        return;
      }
    }

    for (const componentMeta of manifest.components) {
      const componentName = componentMeta?.name;
      if (!componentName) {
        continue;
      }
      const canonicalSlug = typeof manifest.slug === 'string' ? manifest.slug.trim() : '';
      const normalizedSlug = canonicalSlug ? canonicalSlug.toLowerCase() : '';
      const existingEntry = extensionComponentRegistry[componentName];
      const hasExistingName = Boolean(existingEntry);
      if (hasExistingName) {
        warn(
          `Component "${componentName}" from "${manifest.slug}" conflicts with existing registration from "${existingEntry.slug}". ` +
          `The global lookup will resolve to the "${existingEntry.slug}" version. ` +
          `Use source-qualified syntax "${normalizedSlug}:${componentName}" in site configs to reference this version.`,
        );
      }

      let normalizedComponent = null;

      if (componentMeta.module) {
        normalizedComponent = resolveComponentModule(manifestPath, componentMeta.module, {
          slug: manifest.slug,
          componentName,
        });
      }

      if (!normalizedComponent) {
        const exported = exportedComponents[componentName];
        normalizedComponent = toPlainModule(exported) || exported;
      }

      if (!normalizedComponent) {
        warn(`Component "${componentName}" declared in manifest "${manifest.slug}" is missing from the entry exports.`);
        continue;
      }

      const definition = {
        component: normalizedComponent,
        configKey: componentMeta.configKey || null,
        allowedPages: Array.isArray(componentMeta.allowedPages) && componentMeta.allowedPages.length
          ? [...componentMeta.allowedPages]
          : null,
        minAppVersion: typeof componentMeta.minAppVersion === 'string' && componentMeta.minAppVersion.trim()
          ? componentMeta.minAppVersion.trim()
          : null,
        requiredContent: Array.isArray(componentMeta.requiredContent) && componentMeta.requiredContent.length
          ? [...componentMeta.requiredContent]
          : null,
        propsInterface: componentMeta.propsInterface || null,
        slug: canonicalSlug || manifest.slug,
        normalizedSlug,
      };
      if (!hasExistingName) {
        extensionComponentRegistry[componentName] = definition;
      }
      if (normalizedSlug) {
        const sourceKey = `${normalizedSlug}:${componentName}`;
        extensionComponentRegistryBySource[sourceKey] = definition;
        const existingSources = extensionComponentSourcesByName[componentName] || new Set();
        existingSources.add(normalizedSlug);
        extensionComponentSourcesByName[componentName] = existingSources;
      }
      registerComponentMeta({
        name: componentName,
        description: componentMeta.description,
        configKey: componentMeta.configKey,
        allowedPages: componentMeta.allowedPages,
        propsInterface: componentMeta.propsInterface,
        requiredContent: componentMeta.requiredContent,
        minAppVersion: componentMeta.minAppVersion,
        slug: manifest.slug,
        version: manifest.version,
        provider: manifest.provider,
      });
    }
  }),
);

// Load content defaults keyed by extension slug
for (const [path, module] of Object.entries(contentDefaultModules)) {
  const defaults = toPlainModule(module);
  if (!defaults || typeof defaults !== 'object') continue;
  const slugMatch = path.match(/extensions\/([^/]+)\/content\.defaults\.json$/);
  if (!slugMatch) continue;
  const slug = slugMatch[1].toLowerCase();
  extensionContentDefaults[slug] = Object.freeze(defaults);
}

/**
 * Register an external extension package.
 *
 * Called by the Vite plugin for each extension passed via the `extensions` option.
 * Must be called before the first render (during app initialisation).
 *
 * @param {object} extensionModule - Default export from a @koehler8/cms-ext-* package
 *   Expected shape: { manifest, components (import.meta.glob result), contentDefaults? }
 */
export async function registerExtension(extensionModule) {
  if (!extensionModule || typeof extensionModule !== 'object') {
    throw new Error('[extensions] registerExtension() requires an extension module object');
  }

  const manifest = extensionModule.manifest;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('[extensions] registerExtension() module must include a manifest');
  }

  const validate = await getValidator();
  const isValid = validate(manifest);
  if (!isValid) {
    warn(`External extension "${manifest.slug}" failed validation.`, validate.errors);
    return;
  }

  const externalComponents = extensionModule.components || {};
  const externalDefaults = extensionModule.contentDefaults;

  // Build a component lookup from the external glob result.
  // Keys are relative paths like './components/Cookies.vue'; manifest module paths
  // also start with './'.  We normalise both for matching.
  const normalisePath = (p) => p.replace(/^\.\/+/, '');

  const componentLoaders = {};
  for (const [key, loader] of Object.entries(externalComponents)) {
    componentLoaders[normalisePath(key)] = loader;
  }

  // If the extension has an entry file (like compliance), try to load it
  let exportedComponents = {};
  const needsEntry = manifest.components.some((c) => !c?.module);
  if (needsEntry && manifest.entry) {
    const entryNorm = normalisePath(manifest.entry);
    const entryLoader = componentLoaders[entryNorm];
    if (entryLoader) {
      try {
        const entryModule = await entryLoader();
        let entry = toPlainModule(entryModule);
        if (typeof entry === 'function') entry = entry();
        exportedComponents = entry?.components || entry || {};
      } catch (error) {
        warn(`External extension "${manifest.slug}" entry failed to load.`, error);
      }
    }
  }

  for (const componentMeta of manifest.components) {
    const componentName = componentMeta?.name;
    if (!componentName) continue;

    const canonicalSlug = (manifest.slug || '').trim();
    const normalizedSlug = canonicalSlug.toLowerCase();
    const hasExistingName = Boolean(extensionComponentRegistry[componentName]);

    let normalizedComponent = null;

    // Try module path from manifest
    if (componentMeta.module) {
      const moduleNorm = normalisePath(componentMeta.module);
      const loader = componentLoaders[moduleNorm];
      if (loader) {
        normalizedComponent = createAsyncComponent(loader, {
          slug: manifest.slug,
          componentName,
        });
      } else {
        warn(`Component "${componentName}" module "${componentMeta.module}" not found in "${manifest.slug}" package.`);
      }
    }

    // Fall back to entry exports
    if (!normalizedComponent) {
      const exported = exportedComponents[componentName];
      normalizedComponent = toPlainModule(exported) || exported;
    }

    if (!normalizedComponent) {
      warn(`Component "${componentName}" from external "${manifest.slug}" could not be resolved.`);
      continue;
    }

    if (hasExistingName) {
      warn(
        `Component "${componentName}" from "${manifest.slug}" conflicts with existing registration. ` +
        `Use source-qualified syntax "${normalizedSlug}:${componentName}".`,
      );
    }

    const definition = {
      component: normalizedComponent,
      configKey: componentMeta.configKey || null,
      allowedPages: Array.isArray(componentMeta.allowedPages) && componentMeta.allowedPages.length
        ? [...componentMeta.allowedPages]
        : null,
      minAppVersion: typeof componentMeta.minAppVersion === 'string' && componentMeta.minAppVersion.trim()
        ? componentMeta.minAppVersion.trim()
        : null,
      requiredContent: Array.isArray(componentMeta.requiredContent) && componentMeta.requiredContent.length
        ? [...componentMeta.requiredContent]
        : null,
      propsInterface: componentMeta.propsInterface || null,
      slug: canonicalSlug || manifest.slug,
      normalizedSlug,
    };

    if (!hasExistingName) {
      extensionComponentRegistry[componentName] = definition;
    }
    if (normalizedSlug) {
      extensionComponentRegistryBySource[`${normalizedSlug}:${componentName}`] = definition;
      const existingSources = extensionComponentSourcesByName[componentName] || new Set();
      existingSources.add(normalizedSlug);
      extensionComponentSourcesByName[componentName] = existingSources;
    }
    registerComponentMeta({
      name: componentName,
      description: componentMeta.description,
      configKey: componentMeta.configKey,
      allowedPages: componentMeta.allowedPages,
      propsInterface: componentMeta.propsInterface,
      requiredContent: componentMeta.requiredContent,
      minAppVersion: componentMeta.minAppVersion,
      slug: manifest.slug,
      version: manifest.version,
      provider: manifest.provider,
    });
  }

  // Load content defaults
  if (externalDefaults && typeof externalDefaults === 'object') {
    const slug = (manifest.slug || '').toLowerCase();
    if (slug) {
      extensionContentDefaults[slug] = Object.freeze(
        typeof externalDefaults.default === 'object' ? externalDefaults.default : externalDefaults,
      );
    }
  }

  // Register setup function if provided
  if (typeof extensionModule.setup === 'function') {
    extensionSetupFns.push({ slug: manifest.slug, setup: extensionModule.setup });
  }
}

// NOTE: These frozen snapshots are taken after bundled extension discovery.
// External extensions registered via registerExtension() write directly to the
// mutable registries above, which the getter functions read from.
const extensionComponentDefinitions = extensionComponentRegistry;
const extensionComponentDefinitionsBySource = extensionComponentRegistryBySource;
// Live proxy so external extensions registered via registerExtension() are
// visible to the component resolver (the old frozen snapshot missed them).
const extensionComponentSources = new Proxy({}, {
  get(_, name) {
    const sourceSet = extensionComponentSourcesByName[name];
    return sourceSet ? [...sourceSet] : undefined;
  },
  has(_, name) {
    return name in extensionComponentSourcesByName;
  },
  ownKeys() {
    return Object.keys(extensionComponentSourcesByName);
  },
  getOwnPropertyDescriptor(_, name) {
    if (name in extensionComponentSourcesByName) {
      return { configurable: true, enumerable: true, value: [...extensionComponentSourcesByName[name]] };
    }
    return undefined;
  },
});

export const registeredExtensionComponents = new Proxy({}, {
  get(_, name) {
    const entry = extensionComponentRegistry[name];
    return entry ? entry.component : null;
  },
  ownKeys() {
    return Object.keys(extensionComponentRegistry);
  },
  getOwnPropertyDescriptor(_, name) {
    if (name in extensionComponentRegistry) {
      return { configurable: true, enumerable: true, value: extensionComponentRegistry[name].component };
    }
    return undefined;
  },
});
export const extensionComponentsCatalog = extensionComponentCatalog;

export function getExtensionComponent(name) {
  const entry = extensionComponentRegistry[name];
  return entry ? entry.component : null;
}

export function getExtensionComponentDefinition(name) {
  return extensionComponentRegistry[name] || null;
}

export function getExtensionContentDefaults(slug, configKey) {
  if (!slug || !configKey) return undefined;
  const normalizedSlug = slug.toLowerCase();
  const defaults = extensionContentDefaults[normalizedSlug];
  if (!defaults || typeof defaults !== 'object') return undefined;
  return defaults[configKey] || undefined;
}

/**
 * Run setup functions registered by external extensions.
 *
 * Called once during app initialisation (inside the ViteSSG callback) after
 * Pinia and the router are available.  Gives extensions access to the Vue app
 * instance so they can install plugins, register stores, and set up providers.
 *
 * @param {object} ctx - { app, router, pinia, siteData, isClient }
 */
export async function runExtensionSetups(ctx) {
  for (const { slug, setup } of extensionSetupFns) {
    try {
      await setup(ctx);
    } catch (err) {
      warn(`Setup for extension "${slug}" failed.`, err);
    }
  }
}

export {
  extensionComponentDefinitions,
  extensionComponentDefinitionsBySource,
  extensionComponentSources,
};
