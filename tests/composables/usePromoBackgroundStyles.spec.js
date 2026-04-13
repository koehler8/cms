import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { usePromoBackgroundStyles } from '../../src/composables/usePromoBackgroundStyles.js';

describe('usePromoBackgroundStyles', () => {
  it('returns empty string when no image set data', () => {
    const style = usePromoBackgroundStyles({ imageSet: {} });
    expect(style.value).toBe('');
  });

  it('builds fallback background-image from fallbackSrc', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value).toContain('url("/img/promo.jpg")');
    expect(style.value).toContain('background-image:');
  });

  it('builds image-set from sources', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([
          { type: 'image/avif', srcset: '/img/promo-1920.avif 1920w, /img/promo-1024.avif 1024w' },
          { type: 'image/webp', srcset: '/img/promo-1920.webp 1920w' },
        ]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value).toContain('image-set(');
    expect(style.value).toContain('/img/promo-1920.avif');
    expect(style.value).toContain('/img/promo-1920.webp');
  });

  it('selects largest entry from srcset (by width)', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([
          { type: 'image/avif', srcset: '/small.avif 640w, /large.avif 1920w' },
        ]),
        fallbackSrc: ref(''),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value).toContain('/large.avif');
    expect(style.value).not.toContain('/small.avif');
  });

  it('selects largest entry from srcset (by pixel ratio)', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([
          { type: 'image/webp', srcset: '/1x.webp 1x, /2x.webp 2x' },
        ]),
        fallbackSrc: ref(''),
        fallbackFormat: ref('webp'),
      },
    });
    expect(style.value).toContain('/2x.webp');
  });

  it('converts jpg to jpeg for MIME type', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value).toContain('image/jpeg');
    expect(style.value).not.toContain('image/jpg');
  });

  it('does not convert non-jpg formats', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.webp'),
        fallbackFormat: ref('webp'),
      },
    });
    expect(style.value).toContain('image/webp');
  });
});
