import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Lightweight IntersectionObserver helper for deferring media loading.
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] - Disable to render immediately.
 * @param {string} [options.rootMargin='200px 0px'] - IntersectionObserver rootMargin.
 * @param {number|number[]} [options.threshold=0.01] - IntersectionObserver threshold.
 * @returns {{ isVisible: import('vue').Ref<boolean>, targetRef: import('vue').Ref<HTMLElement | null> }}
 */
export function useLazyImage(options = {}) {
  const {
    enabled = true,
    rootMargin = '200px 0px',
    threshold = 0.01,
  } = options;

  const isClient = typeof window !== 'undefined';
  const isVisible = ref(!enabled || !isClient);
  const targetRef = ref(null);
  let observer = null;
  let didResolve = !enabled || !isClient;

  const resolveVisibility = () => {
    if (didResolve) return;
    isVisible.value = true;
    didResolve = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  onMounted(() => {
    if (!enabled || !isClient) {
      resolveVisibility();
      return;
    }

    const target = targetRef.value;
    if (!target) {
      resolveVisibility();
      return;
    }

    if (!('IntersectionObserver' in window)) {
      resolveVisibility();
      return;
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          resolveVisibility();
        }
      },
      {
        rootMargin,
        threshold,
      }
    );

    observer.observe(target);
  });

  onBeforeUnmount(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });

  return {
    isVisible,
    targetRef,
  };
}
