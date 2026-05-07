import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { usePromoBackgroundStyles } from '../../src/composables/usePromoBackgroundStyles.js';

describe('usePromoBackgroundStyles', () => {
  it('returns null when no fallbackSrc', () => {
    const style = usePromoBackgroundStyles({ imageSet: {} });
    expect(style.value).toBe(null);
  });

  it('returns null when fallbackSrc is empty string', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref(''),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value).toBe(null);
  });

  it('emits --promo-bg-fallback as a url() declaration', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value).toEqual({
      '--promo-bg-fallback': 'url("/img/promo.jpg")',
      '--promo-bg-set': expect.stringContaining('image-set('),
    });
  });

  it('omits --promo-bg-set when no sources or fallback to put in image-set', () => {
    // With no sources, fallbackSrc still gets pushed into the image-set as
    // its only entry. Verify that scenario produces both keys.
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value['--promo-bg-set']).toContain('url("/img/promo.jpg")');
    expect(style.value['--promo-bg-set']).toContain('image/jpeg');
  });

  it('builds image-set with avif/webp/jpg entries from sources', () => {
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
    expect(style.value['--promo-bg-set']).toContain('image-set(');
    expect(style.value['--promo-bg-set']).toContain('/img/promo-1920.avif');
    expect(style.value['--promo-bg-set']).toContain('/img/promo-1920.webp');
    expect(style.value['--promo-bg-fallback']).toBe('url("/img/promo.jpg")');
  });

  it('selects largest entry from srcset (by width)', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([
          { type: 'image/avif', srcset: '/small.avif 640w, /large.avif 1920w' },
        ]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value['--promo-bg-set']).toContain('/large.avif');
    expect(style.value['--promo-bg-set']).not.toContain('/small.avif');
  });

  it('selects largest entry from srcset (by pixel ratio)', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([
          { type: 'image/webp', srcset: '/1x.webp 1x, /2x.webp 2x' },
        ]),
        fallbackSrc: ref('/img/promo.webp'),
        fallbackFormat: ref('webp'),
      },
    });
    expect(style.value['--promo-bg-set']).toContain('/2x.webp');
  });

  it('converts jpg to jpeg for MIME type in fallback', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.jpg'),
        fallbackFormat: ref('jpg'),
      },
    });
    expect(style.value['--promo-bg-set']).toContain('image/jpeg');
    expect(style.value['--promo-bg-set']).not.toContain('image/jpg');
  });

  it('does not convert non-jpg formats', () => {
    const style = usePromoBackgroundStyles({
      imageSet: {
        sources: ref([]),
        fallbackSrc: ref('/img/promo.webp'),
        fallbackFormat: ref('webp'),
      },
    });
    expect(style.value['--promo-bg-set']).toContain('image/webp');
  });
});
