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
 * Build a CSS background-image declaration that respects the neon backdrop toggle
 * and reuses the responsive image metadata returned by `useResponsiveImage`.
 * @param {object} options
 * @param {{
 *   sources: import('vue').MaybeRefOrGetter<Array<{ type: string, srcset: string }>>,
 *   fallbackSrc: import('vue').MaybeRefOrGetter<string>,
 *   fallbackFormat: import('vue').MaybeRefOrGetter<string>
 * }} options.imageSet
 */
export function usePromoBackgroundStyles({ imageSet }) {
  return computed(() => {
    const fallbackSrc = unref(imageSet?.fallbackSrc) || '';
    const fallbackFormat = (unref(imageSet?.fallbackFormat) || 'jpg').toLowerCase();
    const sources = unref(imageSet?.sources) || [];

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

    const cssImageSet = formatEntries.length ? `image-set(${formatEntries.join(', ')})` : '';
    let style = '';

    if (fallbackSrc) {
      style += `background-image: url("${fallbackSrc}");`;
    }
    if (cssImageSet) {
      style += `background-image: ${cssImageSet};`;
    }

    return style;
  });
}
