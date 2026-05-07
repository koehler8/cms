import { computed, unref } from 'vue';

function selectLargestEntry(srcset = '') {
  if (!srcset) return '';
  const candidates = srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor] = entry.split(/\s+/);
      let score = 0;
      if (descriptor?.endsWith('w')) {
        score = Number.parseInt(descriptor.replace(/\D+/g, ''), 10) || 0;
      } else if (descriptor?.endsWith('x')) {
        score = Number.parseFloat(descriptor.replace(/[^\d.]/g, '')) * 1000;
      }
      return { url, score };
    })
    .filter(({ url }) => Boolean(url))
    .sort((a, b) => b.score - a.score);

  return candidates.length ? candidates[0].url : '';
}

/**
 * Build a hero-background style binding that pairs a `url()` fallback with an
 * `image-set()` upgrade. Returns an OBJECT with two CSS custom properties.
 *
 * Why an object with custom properties instead of a single `background-image`
 * string: Vue 3's `:style` parses a string into a normalized object keyed by
 * property name. A string with two `background-image` declarations
 * (`background-image: url(...); background-image: image-set(...)`) collapses
 * to a single entry — only the last value survives. This loses the
 * progressive-enhancement chain that's the whole point of pairing a `url()`
 * fallback with an `image-set()` upgrade. By emitting two custom properties,
 * Vue keeps both, and the consuming CSS rule chains them as two real
 * declarations of `background-image` so browsers walk the cascade naturally.
 *
 * Consumed by Hero.vue's `.promo-surface` rule, which declares:
 *
 *   background-image: var(--promo-bg-fallback);
 *   background-image: var(--promo-bg-set, var(--promo-bg-fallback));
 *
 * Browsers that can parse `image-set()` (and its `type()` argument) use the
 * second declaration; browsers that can't fall through to the first.
 *
 * @param {object} options
 * @param {{
 *   sources: import('vue').MaybeRefOrGetter<Array<{ type: string, srcset: string }>>,
 *   fallbackSrc: import('vue').MaybeRefOrGetter<string>,
 *   fallbackFormat: import('vue').MaybeRefOrGetter<string>
 * }} options.imageSet
 * @returns {import('vue').ComputedRef<Record<string, string> | null>}
 */
export function usePromoBackgroundStyles({ imageSet }) {
  return computed(() => {
    const fallbackSrc = unref(imageSet?.fallbackSrc) || '';
    const fallbackFormat = (unref(imageSet?.fallbackFormat) || 'jpg').toLowerCase();
    const sources = unref(imageSet?.sources) || [];

    if (!fallbackSrc) return null;

    const formatEntries = [];
    sources.forEach((source) => {
      const largest = selectLargestEntry(source?.srcset);
      if (largest) {
        formatEntries.push(`url("${largest}") type("${source?.type}") 1x`);
      }
    });
    if (fallbackSrc) {
      const fallbackMime = fallbackFormat === 'jpg' ? 'jpeg' : fallbackFormat;
      formatEntries.push(`url("${fallbackSrc}") type("image/${fallbackMime}") 1x`);
    }

    const result = {
      '--promo-bg-fallback': `url("${fallbackSrc}")`,
    };
    if (formatEntries.length) {
      result['--promo-bg-set'] = `image-set(${formatEntries.join(', ')})`;
    }
    return result;
  });
}
