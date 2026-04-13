<template>
  <section id="about" class="section-shell intro-section" data-analytics-section="intro">
    <div class="container">
      <div class="intro-grid">
        <div class="intro-column">
          <div class="intro-heading">
            <h2 class="intro-title">
              {{ introTitle }}
            </h2>
            <div class="intro-divider" aria-hidden="true"></div>
          </div>
          <div class="intro-copy">
            <p>{{ introText }}</p>
          </div>
        </div>
        <div class="intro-column">
          <div
            ref="introImageTarget"
            class="responsive-picture-shell rounded intro-media"
            style="aspect-ratio: 18 / 10;"
          >
            <picture v-if="isIntroImageVisible" class="responsive-picture">
              <source
                v-for="source in introImageSources"
                :key="source.type"
                :type="source.type"
                :srcset="source.srcset"
                :sizes="introImageSizes"
              />
              <img
                :src="introImageFallback"
                :srcset="introImageFallbackSet || undefined"
                :sizes="introImageSizes"
                :alt="introImgText"
                @error="introImageHandleError"
                width="540"
                height="300"
                loading="lazy"
                decoding="async"
                class="rounded intro-image responsive-picture__img"
              />
            </picture>
            <div
              v-else
              class="responsive-picture-placeholder rounded intro-image"
              :style="introPlaceholder ? { backgroundImage: `url(${introPlaceholder})` } : null"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import { computed, inject, ref } from 'vue';
  import { useResponsiveImage } from '../utils/imageSources.js';
  import { useLazyImage } from '../composables/useLazyImage.js';

  const injectedSiteData = inject('siteData', ref({}));
  const pageContent = inject('pageContent', ref({}));

  const introData = computed(() => pageContent.value?.intro || {});

  const introTitle = computed(() => introData.value?.title || '');
  const introText = computed(() => introData.value?.text || '');

  const introImage = useResponsiveImage('img/intro', {
    widths: [320, 540],
    fallbackFormat: 'jpg',
  });
  const introImageHandleError = introImage.handleError;

  const introImageSizes = '(min-width: 1200px) 40vw, (min-width: 992px) 45vw, 100vw';
  const { isVisible: isIntroImageVisible, targetRef: introImageTarget } = useLazyImage({
    rootMargin: '200px 0px',
  });

  const introImageSources = introImage.sources;
  const introImageFallback = introImage.fallbackSrc;
  const introImageFallbackSet = introImage.fallbackSrcSet;
  const introPlaceholder = introImage.placeholderSrc;

const introImgText = computed(() => {
    if (introData.value?.imgAlt) return introData.value.imgAlt;
    const siteTitle = injectedSiteData.value?.site?.title || '';
    return siteTitle ? `Introducing ${siteTitle}` : 'Introducing';
  });
</script>

<style scoped>
.intro-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: clamp(24px, 6vw, 48px);
  align-items: center;
}

.intro-heading {
  margin-bottom: var(--ui-space-24, 24px);
}

.intro-title {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: clamp(1.5rem, 4vw, 2.25rem);
  margin: 0 0 0.75rem;
}

.intro-divider {
  width: 60px;
  height: 3px;
  background: var(--intro-divider-color, var(--brand-accent-electric, #4f6cf0));
  border-radius: 999px;
  margin-top: var(--ui-space-12, 12px);
}

.intro-copy {
  font-size: 1rem;
  color: var(--ui-text-primary, var(--brand-fg-100, #1f2a44));
}

.intro-media {
  transition: box-shadow 0.3s ease;
}

.intro-image {
  border-radius: inherit;
}
</style>
