import { computed } from 'vue';

const DEFAULT_MODAL = {
  title: 'Coming Soon',
  message: "We're putting the finishing touches on this experience. Check back soon.",
};

const COMING_SOON_PREFIX = 'coming-soon';

function normalizeModal(source, fallback = null) {
  if (!source || typeof source !== 'object') {
    return fallback;
  }

  const modal = source.modal && typeof source.modal === 'object' ? source.modal : null;
  const titleCandidate = [
    source.title,
    modal?.title,
    fallback?.title,
    DEFAULT_MODAL.title,
  ].find((value) => typeof value === 'string' && value.trim());
  const messageCandidate = [
    source.message,
    modal?.message,
    fallback?.message,
    DEFAULT_MODAL.message,
  ].find((value) => typeof value === 'string' && value.trim());

  if (!titleCandidate || !messageCandidate) {
    return fallback;
  }

  return {
    title: titleCandidate.trim(),
    message: messageCandidate.trim(),
  };
}

function parseComingSoonAction(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  const value = String(rawValue).trim();
  if (!value) {
    return null;
  }

  const lowerValue = value.toLowerCase();
  const prefix = COMING_SOON_PREFIX;

  if (lowerValue === prefix) {
    return { variant: null };
  }

  if (lowerValue.startsWith(`${prefix}:`)) {
    const variant = value.slice(prefix.length + 1).trim();
    return { variant: variant || null };
  }

  return null;
}

function resolveVariant(config, variant) {
  const baseModal = normalizeModal(config, DEFAULT_MODAL);
  if (!baseModal) {
    return null;
  }

  if (!variant) {
    return baseModal;
  }

  const variants = config?.variants;
  if (!variants || typeof variants !== 'object') {
    return baseModal;
  }

  const variantConfig = variants[variant] || variants[variant.toLowerCase()];
  if (!variantConfig) {
    return baseModal;
  }

  return normalizeModal(variantConfig, baseModal) || baseModal;
}

/**
 * Build a resolver that checks action href values for the "coming-soon"
 * directive and returns the modal payload to show when present.
 * @param {Ref<Record<string, any>>} pageContentRef
 * @returns {{ resolve(options: { href?: string | null }): { title: string, message: string, variant: string | null } | null, isComingSoonAction(href: string): boolean }}
 */
export function useComingSoonResolver(pageContentRef) {
  const comingSoonConfig = computed(() => pageContentRef?.value?.comingSoon || null);

  return {
    resolve(options = {}) {
      const parsed = parseComingSoonAction(options?.href);
      if (!parsed) {
        return null;
      }

      const config = comingSoonConfig.value || {};
      const modal = resolveVariant(config, parsed.variant);
      if (!modal) {
        return null;
      }

      return {
        ...modal,
        variant: parsed.variant ? parsed.variant.toLowerCase() : null,
      };
    },
    isComingSoonAction(href) {
      return Boolean(parseComingSoonAction(href));
    },
  };
}

export { COMING_SOON_PREFIX };
