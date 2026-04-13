import { computed, ref, watch, unref } from 'vue';
import { resolveAsset } from './assetResolver.js';

const DEFAULT_FORMATS = ['avif', 'webp'];

function normalizeBasePath(relativePath = '') {
  if (!relativePath || typeof relativePath !== 'string') {
    return '';
  }
  const trimmed = relativePath.replace(/^\/+/, '');
  return trimmed.replace(/\.[^/.]+$/, '');
}

function normalizeWidths(widths) {
  const unique = new Set();
  (Array.isArray(widths) ? widths : [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .forEach((value) => unique.add(value));
  return Array.from(unique).sort((a, b) => a - b);
}

function buildSrcSet(basePath, widthList, format) {
  const entries = [];
  for (const width of widthList) {
    const candidate = `${basePath}-${width}.${format}`;
    const url = resolveAsset(candidate);
    if (url) {
      entries.push(`${url} ${width}w`);
    }
  }

  // Fallback to a non-suffixed asset when available.
  if (entries.length === 0) {
    const fallbackUrl = resolveAsset(`${basePath}.${format}`);
    if (fallbackUrl) {
      entries.push(`${fallbackUrl} 1x`);
    }
  }

  return entries.join(', ');
}

function resolveBestFallback(basePath, widthList, format) {
  const reversed = [...widthList].sort((a, b) => b - a);
  for (const width of reversed) {
    const candidate = resolveAsset(`${basePath}-${width}.${format}`);
    if (candidate) {
      return candidate;
    }
  }
  return resolveAsset(`${basePath}.${format}`) || '';
}

/**
 * Build responsive image sources for site media.
 * @param {string} relativePath - Path relative to site asset directory (e.g. "img/promo").
 * @param {object} [options]
 * @param {number[]} [options.widths] - Explicit width breakpoints.
 * @param {string} [options.fallbackFormat='jpg'] - Format for the <img> fallback.
 * @param {string[]} [options.formats] - Additional <source> formats (default: avif + webp).
 * @returns {{
 *   sources: import('vue').ComputedRef<Array<{ type: string, srcset: string }>>,
 *   fallbackSrc: import('vue').ComputedRef<string>,
 *   fallbackSrcSet: import('vue').ComputedRef<string>,
 *   placeholderSrc: import('vue').ComputedRef<string>
 * }}
 */
export function useResponsiveImage(relativePath, options = {}) {
  const basePath = computed(() => normalizeBasePath(unref(relativePath)));
  const widthInput = options.widths;
  const widths = computed(() => normalizeWidths(unref(widthInput)));
  const fallbackFormat = computed(() => unref(options.fallbackFormat) || 'jpg');
  const formats = computed(() => {
    const provided = unref(options.formats);
    return Array.isArray(provided) && provided.length ? provided : DEFAULT_FORMATS;
  });
  const errorHandled = ref(false);

  const sources = computed(() => {
    const base = basePath.value;
    if (!base) return [];

    return formats.value
      .map((format) => {
        const srcset = buildSrcSet(base, widths.value, format);
        if (!srcset) return null;
        return {
          type: `image/${format}`,
          srcset,
        };
      })
      .filter(Boolean);
  });

  const fallbackSrc = computed(() => {
    const base = basePath.value;
    if (!base) return '';
    return resolveBestFallback(base, widths.value, fallbackFormat.value);
  });

  const fallbackSrcSet = computed(() => {
    const base = basePath.value;
    if (!base) return '';
    return buildSrcSet(base, widths.value, fallbackFormat.value);
  });

  const placeholderSrc = computed(() => {
    const base = basePath.value;
    if (!base) return '';
    const widthList = widths.value;
    if (widthList.length === 0) {
      return resolveAsset(`${base}.${fallbackFormat.value}`) || '';
    }
    const smallestWidth = widthList[0];
    return (
      resolveAsset(`${base}-${smallestWidth}.${fallbackFormat.value}`) ||
      resolveAsset(`${base}-${smallestWidth}.webp`) ||
      resolveAsset(`${base}.${fallbackFormat.value}`) ||
      ''
    );
  });

  watch([fallbackSrc, fallbackSrcSet], () => {
    errorHandled.value = false;
  });

  const handleError = (event) => {
    if (errorHandled.value) return;
    const target = event?.target;
    if (!target || target.tagName !== 'IMG') return;
    const fallback = fallbackSrc.value;
    if (!fallback) return;
    errorHandled.value = true;

    const picture = target.closest('picture');
    if (picture) {
      picture.querySelectorAll('source').forEach((source) => {
        source.removeAttribute('srcset');
        source.removeAttribute('sizes');
      });
    }

    target.removeAttribute('srcset');
    target.removeAttribute('sizes');
    target.onerror = null;

    let absoluteFallback = fallback;
    if (typeof window !== 'undefined') {
      try {
        absoluteFallback = new URL(fallback, window.location.href).href;
      } catch (error) {
        // Relative URL fallback; ignore.
      }
    }

    if (target.src === absoluteFallback) {
      target.removeAttribute('src');
      const schedule =
        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (fn) => setTimeout(fn, 0);
      schedule(() => {
        target.src = fallback;
      });
    } else {
      target.src = fallback;
    }
  };

  return {
    sources,
    fallbackSrc,
    fallbackSrcSet,
    placeholderSrc,
    fallbackFormat,
    handleError,
  };
}
