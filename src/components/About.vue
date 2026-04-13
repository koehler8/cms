<template>
  <section
    id="about"
    class="about-section section-shell section-shell--tight ui-section--overlay"
    data-analytics-section="about-overview"
  >
    <div
      v-for="slice in aboutSlices"
      :key="slice.key"
      class="container about-slice"
      :class="`about-slice--${slice.key}`"
    >
      <div class="about-slice__grid" :class="{ 'about-slice__grid--reversed': slice.reversed }">
        <div class="about-slice__media" :class="slice.mediaClass">
          <div
            :ref="slice.image.assignRef"
            :class="[
              'responsive-picture-shell',
              'rounded',
              'about-picture',
              slice.image.wrapperVariant,
            ]"
            :style="{ aspectRatio: slice.image.aspectRatio }"
          >
            <picture v-if="slice.image.isVisible" class="responsive-picture">
              <source
                v-for="source in slice.image.sources"
                :key="source.type"
                :type="source.type"
                :srcset="source.srcset"
                :sizes="slice.image.sizes"
              />
              <img
                :src="slice.image.fallback"
                :srcset="slice.image.fallbackSet || undefined"
                :sizes="slice.image.sizes"
                :alt="siteName"
                @error="slice.image.onError"
                :width="slice.image.width"
                :height="slice.image.height"
                loading="lazy"
                decoding="async"
                class="responsive-picture__img about-picture__img"
              />
            </picture>
            <div
              v-else
              class="responsive-picture-placeholder rounded about-picture__img"
              :style="slice.image.placeholder ? { backgroundImage: `url(${slice.image.placeholder})` } : null"
            ></div>
          </div>
        </div>
        <div class="about-slice__content" :class="slice.contentClass">
          <div
            :class="['about-text-wrapper', 'about-text-wrapper--raised', slice.textWrapperClass]"
          >
            <div class="about-text-block brand-card brand-card--translucent">
              <h2 class="about-heading" v-html="slice.content.title"></h2>
              <p class="about-copy" v-html="slice.content.copy"></p>
            </div>
            <a
              class="about-cta primary-button"
              :href="slice.content.button.href || '#'"
              @click="handleAboutButtonClick($event, slice.content.rawButton, slice.buttonOrigin)"
            >
              <span class="about-cta__label">{{ slice.content.button.text }}</span>
              <span class="about-cta__icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" role="presentation" aria-hidden="true">
                  <path
                    d="M3 8h10m0 0-4-4m4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, ref } from 'vue';
import { useComingSoonInterstitial } from '../composables/useComingSoonInterstitial.js';
import { trackEvent } from '../utils/analytics.js';
import { useComingSoonResolver } from '../composables/useComingSoonConfig.js';
import { useResponsiveImage } from '../utils/imageSources.js';
import { useLazyImage } from '../composables/useLazyImage.js';

const { openComingSoon } = useComingSoonInterstitial();

const injectedSiteData = inject('siteData', ref({}));
const pageContent = inject('pageContent', ref({}));
const { resolve: resolveComingSoon } = useComingSoonResolver(pageContent);

const aboutContent = computed(() => pageContent.value?.about || {});

const getAboutValue = (key, fallback) => {
  const value = aboutContent.value?.[key];
  return value === undefined || value === null ? fallback : value;
};

const siteName = computed(() => injectedSiteData.value?.site?.title || '');

const aboutTopTitle = computed(() => getAboutValue('topTitle', ''));
const aboutTopCopy = computed(() => getAboutValue('topCopy', ''));
const aboutBottomTitle = computed(() => getAboutValue('bottomTitle', ''));
const aboutBottomCopy = computed(() => getAboutValue('bottomCopy', ''));
const aboutTopButton = computed(() => getAboutValue('topButton', {}));
const aboutBottomButton = computed(() => getAboutValue('bottomButton', {}));

const topImage = useResponsiveImage('img/about-top', {
  widths: [320, 900],
  fallbackFormat: 'jpg',
});
const topImageHandleError = topImage.handleError;
const bottomImage = useResponsiveImage('img/about-bottom', {
  widths: [320, 600],
  fallbackFormat: 'jpg',
});
const bottomImageHandleError = bottomImage.handleError;

const topImageSizes = '(min-width: 1200px) 66vw, (min-width: 992px) 60vw, 100vw';
const bottomImageSizes = '(min-width: 1200px) 45vw, (min-width: 992px) 50vw, 100vw';

const { isVisible: isTopImageVisible, targetRef: topImageTarget } = useLazyImage({
  rootMargin: '250px 0px',
});
const { isVisible: isBottomImageVisible, targetRef: bottomImageTarget } = useLazyImage({
  rootMargin: '250px 0px',
});

const topImageSources = topImage.sources;
const topImageFallback = topImage.fallbackSrc;
const topImageFallbackSet = topImage.fallbackSrcSet;
const topPlaceholder = topImage.placeholderSrc;

const bottomImageSources = bottomImage.sources;
const bottomImageFallback = bottomImage.fallbackSrc;
const bottomImageFallbackSet = bottomImage.fallbackSrcSet;
const bottomPlaceholder = bottomImage.placeholderSrc;

const normalizeButton = (button = {}) => ({
  text: button?.text ?? '',
  href: button?.href ?? '#',
});

const bindTemplateRef = (target) => (el) => {
  target.value = el;
};

const aboutSlices = computed(() => [
  {
    key: 'top',
    variant: 'about-top',
    buttonOrigin: 'about-top',
    reversed: false,
    mediaClass: 'about-slice__media--wide',
    contentClass: 'about-slice__content--narrow',
    textWrapperClass: 'about-text-wrapper--top',
    content: {
      title: aboutTopTitle.value,
      copy: aboutTopCopy.value,
      button: normalizeButton(aboutTopButton.value),
      rawButton: aboutTopButton.value,
    },
    image: {
      assignRef: bindTemplateRef(topImageTarget),
      isVisible: isTopImageVisible.value,
      sources: topImageSources.value,
      fallback: topImageFallback.value,
      fallbackSet: topImageFallbackSet.value,
      placeholder: topPlaceholder.value,
      sizes: topImageSizes,
      width: 900,
      height: 450,
      aspectRatio: '2 / 1',
      onError: topImageHandleError,
      wrapperVariant: 'about-picture--primary',
    },
  },
  {
    key: 'bottom',
    variant: 'about-bottom',
    buttonOrigin: 'about-bottom',
    reversed: true,
    mediaClass: 'about-slice__media--half',
    contentClass: 'about-slice__content--offset',
    textWrapperClass: 'about-text-wrapper--bottom',
    content: {
      title: aboutBottomTitle.value,
      copy: aboutBottomCopy.value,
      button: normalizeButton(aboutBottomButton.value),
      rawButton: aboutBottomButton.value,
    },
    image: {
      assignRef: bindTemplateRef(bottomImageTarget),
      isVisible: isBottomImageVisible.value,
      sources: bottomImageSources.value,
      fallback: bottomImageFallback.value,
      fallbackSet: bottomImageFallbackSet.value,
      placeholder: bottomPlaceholder.value,
      sizes: bottomImageSizes,
      width: 600,
      height: 450,
      aspectRatio: '4 / 3',
      onError: bottomImageHandleError,
      wrapperVariant: 'about-picture--outlined',
    },
  },
]);

function handleAboutButtonClick(event, button, origin) {
  if (!event) return;

  const label = (button?.text ?? '').toString();
  const trimmedLabel = label.trim();

  const href = (button?.href ?? '').toString().trim();

  const modalPayload = resolveComingSoon({
    href,
  });
  if (!modalPayload) {
    return;
  }

  event.preventDefault();
  openComingSoon(modalPayload);
  trackEvent('coming_soon_interstitial_shown', {
    trigger: origin,
    label: trimmedLabel ? trimmedLabel.toLowerCase() : 'coming-soon',
  });
}
</script>

<style scoped>
.about-section {
  background: var(--about-section-bg, transparent);
}

.about-section.section-shell--tight {
  padding-top: 50px;
  padding-bottom: 50px;
}

.about-slice {
  padding-block: clamp(24px, 6vw, 56px);
}

.about-slice:last-child {
  padding-bottom: 0;
}

.about-slice--bottom {
  margin-top: clamp(-180px, -12vw, -80px);
  position: relative;
  z-index: 4;
  pointer-events: none;
}

.about-slice--top {
  position: relative;
}

.about-slice__grid {
  display: flex;
  flex-direction: column;
  gap: clamp(20px, 5vw, 48px);
}

.about-slice__media,
.about-slice__content {
  width: 100%;
  position: relative;
}

.about-slice__media {
  z-index: 1;
}

.about-slice__content {
  z-index: 2;
}

@media (min-width: 1024px) {
  .about-slice__grid {
    flex-direction: row;
    align-items: center;
    gap: clamp(24px, 5vw, 64px);
  }

  .about-slice__grid--reversed {
    flex-direction: row-reverse;
  }

  .about-slice__media,
  .about-slice__content {
    flex: 0 0 auto;
  }

  .about-slice__media--wide {
    flex-basis: 60%;
  }

  .about-slice__content--narrow {
    flex-basis: 40%;
  }

  .about-slice__media--half {
    flex-basis: 50%;
  }

  .about-slice__content--offset {
    flex-basis: 42%;
  }
}

.about-picture {
  width: 100%;
  box-shadow: 0 25px 60px
    color-mix(in srgb, var(--brand-surface-card-shadow, rgba(12, 9, 26, 0.45)) 100%, transparent);
  pointer-events: none;
}

.about-picture--outlined {
  border: 1px solid color-mix(in srgb, var(--brand-accent-electric, rgba(39, 243, 255, 0.35)) 35%, transparent);
}

.about-picture__img {
  border-radius: inherit;
  pointer-events: none;
}

.about-picture .responsive-picture-placeholder {
  pointer-events: none;
}

.about-heading,
.about-heading.mb-4 {
  color: var(--ui-text-primary, var(--brand-fg-100));
  font-family: var(--ui-font-heading, 'Space Grotesk', 'Inter', sans-serif);
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.2;
  font-size: clamp(1.5rem, 3vw, 2.375rem);
  max-width: 100%;
  overflow-wrap: anywhere;
  margin: 0;
}

.about-copy {
  color: var(--ui-text-muted, var(--brand-fg-300));
  font-family: var(--ui-font-body, 'Inter', sans-serif);
  font-size: 1rem;
  line-height: 1.7;
  margin-bottom: 0;
}

.about-text-wrapper {
  position: relative;
  max-width: clamp(340px, 36vw, 460px);
}

.about-text-wrapper--raised {
  margin-top: -40px;
}

@media (min-width: 1024px) {
  .about-text-wrapper--raised {
    margin-top: -80px;
  }
}

@media (max-width: 768px) {
  .about-text-wrapper--raised {
    margin-top: 0;
  }
}

.about-text-wrapper--top,
.about-text-wrapper--bottom {
  margin-left: 0;
  margin-right: 0;
}

@media (min-width: 1024px) {
  .about-text-wrapper--top {
    margin-left: clamp(-140px, -9vw, -56px);
  }

  .about-slice__grid--reversed .about-text-wrapper--bottom {
    margin-right: clamp(-120px, -8vw, -48px);
  }
}

.about-text-block {
  position: relative;
  z-index: 1;
  color: inherit;
  margin-bottom: var(--ui-space-24, 24px);
}

.brand-card--translucent {
  background: color-mix(in srgb, var(--brand-surface-card-bg, rgba(20, 18, 30, 0.4)) 65%, transparent);
  backdrop-filter: blur(14px);
  box-shadow:
    0 18px 42px color-mix(in srgb, var(--brand-surface-card-shadow, rgba(5, 5, 10, 0.45)) 65%, transparent),
    inset 0 1px 0 color-mix(in srgb, rgba(255, 255, 255, 0.8) 40%, transparent);
}

.about-cta {
  gap: var(--ui-gap-tight, 8px);
  display: inline-flex;
  align-items: center;
  position: relative;
  z-index: 6;
}

.about-slice--bottom :is(.about-cta, a, button, input, textarea, select) {
  pointer-events: auto;
}

.about-cta__label {
  letter-spacing: inherit;
  text-transform: inherit;
}

.about-cta__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(
    --about-cta-icon-bg,
    var(--brand-icon-badge-bg, var(--brand-accent-electric, #243a80))
  );
  color: var(--about-cta-icon-color, var(--brand-cta-text, #ffffff));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 35%, transparent);
  font-size: 0.75rem;
}

.about-cta__icon svg {
  width: 14px;
  height: 14px;
}

.about-slice--top .about-cta {
  margin-bottom: clamp(20px, 4vw, 80px);
}

.about-slice__content .about-text-wrapper--raised {
  transition: margin-top 0.2s ease;
}

@media (max-width: 480px) {
  .about-slice--top .about-cta {
    margin-bottom: 44px;
  }

  .about-slice__content .about-text-wrapper--raised {
    margin-top: -50px;
  }

  .about-slice--bottom .about-text-wrapper--raised {
    margin-top: -60px;
  }

  .about-slice__media {
    margin-bottom: -8px;
  }
}

</style>
