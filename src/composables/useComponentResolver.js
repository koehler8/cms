import { computed } from 'vue';
import { extensionComponentDefinitionsBySource, extensionComponentSources, getExtensionContentDefaults } from '../extensions/extensionLoader.js';
import { getSiteComponent } from '../utils/componentRegistry.js';
import { APP_VERSION } from '../utils/appInfo.js';
import { satisfiesMinVersion } from '../utils/semver.js';
import { validateRequiredContentPaths } from '../utils/contentRequirements.js';
import { mergeConfigTrees } from '../utils/loadConfig.js';

const extensionDefinitionsBySource = extensionComponentDefinitionsBySource || {};
const extensionSourcesByName = extensionComponentSources || {};

const SITE_SOURCE = 'site';

const normalizePageKey = (value) => (value || '').toString().trim().toLowerCase();
const normalizeSourceKey = (value) => (value || '').toString().trim().toLowerCase();

const reportExtensionIssue = (message, context = {}) => {
  if (!import.meta.env.DEV) return;
  const contextEntries = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null);
  if (contextEntries.length) {
    console.warn('[extensions]', message, Object.fromEntries(contextEntries));
  } else {
    console.warn('[extensions]', message);
  }
};

const resolveExtensionDefinition = (name, sourceSlug) => {
  if (!name) return null;
  const normalizedSource = normalizeSourceKey(sourceSlug);
  if (!normalizedSource) return null;
  const sourceKey = `${normalizedSource}:${name}`;
  return extensionDefinitionsBySource[sourceKey] || null;
};

export function useComponentResolver({ componentKeys, pageContent, currentPage, registry }) {
  const loadedComponents = computed(() => {
    const pageKey = normalizePageKey(currentPage.value.id);
    return componentKeys.value
      .map((entry, index) => {
        let name = '';
        let enabled = true;
        let configKey;
        let source;

        if (entry && typeof entry === 'object') {
          name = typeof entry.name === 'string' ? entry.name : '';
          enabled = entry.enabled !== false;
          configKey = typeof entry.configKey === 'string' ? entry.configKey : undefined;
          source = typeof entry.source === 'string' ? entry.source : undefined;
        } else if (typeof entry === 'string') {
          name = entry;
        }

        if (!enabled) return null;

        let normalizedSource = normalizeSourceKey(source) || null;

        // ---- Site-local components ---------------------------------
        // Pages can reference Vue files dropped into `site/components/`
        // by basename (e.g. site/components/PropertyCard.vue → "PropertyCard").
        // Resolution priority: site > extension > bundled. Use `site:Name`
        // to disambiguate when both site and extension/bundled define a
        // component with the same name.
        if (normalizedSource === SITE_SOURCE) {
          const siteComp = getSiteComponent(name);
          if (!siteComp) {
            reportExtensionIssue(
              `Component "site:${name}" is not registered. Add a Vue file to site/components/${name}.vue.`,
              { component: name, requestedSource: SITE_SOURCE },
            );
            return null;
          }
          return {
            key: `site-${name}-${index}`,
            component: siteComp,
            configKey: configKey || null,
            props: {},
          };
        }
        if (!normalizedSource) {
          const siteComp = getSiteComponent(name);
          if (siteComp) {
            return {
              key: `site-${name}-${index}`,
              component: siteComp,
              configKey: configKey || null,
              props: {},
            };
          }
        }
        // -------------------------------------------------------------

        const availableSources = Array.isArray(extensionSourcesByName[name])
          ? extensionSourcesByName[name]
          : null;

        if (availableSources && availableSources.length) {
          if (!normalizedSource) {
            if (availableSources.length === 1 && !registry[name]) {
              // Single unambiguous extension source and no base component — auto-resolve.
              normalizedSource = normalizeSourceKey(availableSources[0]);
            } else {
              reportExtensionIssue(
                `Component "${name}" comes from an extension. Specify the source slug (available: ${availableSources.join(', ')}) in the component entry.`,
                { component: name, availableSources },
              );
              return null;
            }
          }
          if (!availableSources.includes(normalizedSource)) {
            reportExtensionIssue(
              `Component "${name}" is not provided by the "${source}" extension.`,
              { component: name, requestedSource: normalizedSource, availableSources },
            );
            return null;
          }
        } else if (normalizedSource) {
          reportExtensionIssue(
            `Component "${name}" does not belong to an extension, so the "source" field should be omitted.`,
            { component: name, requestedSource: normalizedSource },
          );
          return null;
        }

        const definition = resolveExtensionDefinition(name, normalizedSource);
        if (availableSources && availableSources.length && !definition) {
          reportExtensionIssue(
            `Component "${name}" could not resolve extension definition for source "${normalizedSource}".`,
            { component: name, requestedSource: normalizedSource },
          );
          return null;
        }
        const isExtension = Boolean(definition);
        let component = isExtension ? definition.component : registry[name];

        if (!component && name && name.startsWith('Spacer')) {
          component = registry.Spacer;
        }

        if (!component) {
          if (import.meta.env.DEV) {
            console.warn(
              `[PageRenderer] Component "${name}"${
                source ? ` from source "${source}"` : ''
              } is not registered in the component registry.`,
            );
          }
          return null;
        }

        const resolvedSource = definition?.slug || normalizedSource || null;
        const keyBase = definition ? `${resolvedSource || 'extension'}-${name}` : (name || `component-${index}`);

        const defaultConfigKey = isExtension ? definition.configKey : undefined;
        const resolvedConfigKey = configKey || defaultConfigKey || null;
        const rawContent =
          resolvedConfigKey && pageContent.value && typeof pageContent.value === 'object'
            ? pageContent.value[resolvedConfigKey]
            : undefined;
        const contentDefaults = isExtension
          ? getExtensionContentDefaults(definition.normalizedSlug, resolvedConfigKey)
          : undefined;
        const resolvedContent = contentDefaults
          ? mergeConfigTrees(contentDefaults, rawContent || {}, { skipEmpty: true })
          : rawContent;

        if (isExtension) {
          if (Array.isArray(definition.allowedPages) && definition.allowedPages.length) {
            const normalizedAllowed = definition.allowedPages
              .map((slug) => normalizePageKey(slug))
              .filter(Boolean);
            if (normalizedAllowed.length && !normalizedAllowed.includes(pageKey)) {
              reportExtensionIssue(`Component "${name}" is not allowed on page "${currentPage.value.id}".`, {
                component: name,
                source: resolvedSource || undefined,
                page: currentPage.value.id,
                allowedPages: normalizedAllowed,
              });
              return null;
            }
          }

          if (definition.minAppVersion && !satisfiesMinVersion(APP_VERSION, definition.minAppVersion)) {
            reportExtensionIssue(
              `Component "${name}" requires app version ${definition.minAppVersion} or higher.`,
              {
                component: name,
                source: resolvedSource || undefined,
                required: definition.minAppVersion,
                current: APP_VERSION,
              },
            );
            return null;
          }

          if (Array.isArray(definition.requiredContent) && definition.requiredContent.length) {
            const { isValid, missing } = validateRequiredContentPaths(
              resolvedContent,
              definition.requiredContent,
            );
            if (!isValid) {
              reportExtensionIssue(
                `Component "${name}" is missing required content.`,
                {
                  component: name,
                  source: resolvedSource || undefined,
                  page: currentPage.value.id,
                  missing,
                  configKey: resolvedConfigKey,
                },
              );
              return null;
            }
          }
        }

        const props = {};
        if (isExtension) {
          props.content = resolvedContent !== undefined ? resolvedContent : null;
          props.configKey = resolvedConfigKey;
        }

        return {
          key: `${keyBase}-${index}`,
          component,
          configKey: resolvedConfigKey,
          props,
        };
      })
      .filter(Boolean);
  });

  return { loadedComponents };
}
