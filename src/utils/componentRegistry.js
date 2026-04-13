const rawModules = import.meta.glob(['../components/**/*.vue', '!../components/Home.vue'], { eager: true });

function normalizeComponentEntry(entry) {
  return entry && typeof entry === 'object' && 'default' in entry ? entry.default : entry;
}

function resolveComponentName(filePath) {
  const normalized = filePath.replace(/^\.{2}\//, '').replace(/\.vue$/i, '');
  const parts = normalized.split('/');
  return parts.length ? parts[parts.length - 1] : normalized;
}

export function createRegistry(modules) {
  const registry = Object.entries(modules).reduce((acc, [file, module]) => {
    const component = normalizeComponentEntry(module);
    if (!component) return acc;

    const componentName = resolveComponentName(file);

    if (!acc[componentName]) {
      acc[componentName] = component;
    }

    if (componentName.startsWith('Spacer') && componentName.length > 'Spacer'.length) {
      const suffix = componentName.slice('Spacer'.length);
      const parsed = Number.parseInt(suffix, 10);
      const score = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;

      const existing = acc.__spacerFallback;
      if (!existing || score < existing.score) {
        acc.__spacerFallback = { component, score };
      }
    }

    return acc;
  }, {});

  if (!registry.Spacer && registry.__spacerFallback && registry.__spacerFallback.component) {
    registry.Spacer = registry.__spacerFallback.component;
  }
  delete registry.__spacerFallback;

  return registry;
}

export const registry = createRegistry(rawModules);
