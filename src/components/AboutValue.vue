<template>
  <section id="about" class="about-value-section section-shell" data-analytics-section="about-value">
    <div v-if="hasValueProps" class="container">
      <div class="about-value__grid">
        <div class="about-value__media">
          <div
            ref="topImageTarget"
            class="responsive-picture-shell rounded value-picture"
            style="aspect-ratio: 2 / 1;"
          >
            <picture v-if="isTopImageVisible" class="responsive-picture">
              <source
                v-for="source in topImageSources"
                :key="source.type"
                :type="source.type"
                :srcset="source.srcset"
                :sizes="topImageSizes"
              />
              <img
                :src="topImageFallback"
                :srcset="topImageFallbackSet || undefined"
                :sizes="topImageSizes"
                :alt="valueImageAlt"
                @error="topImageHandleError"
                width="900"
                height="450"
                loading="lazy"
                decoding="async"
                class="responsive-picture__img rounded"
              />
            </picture>
            <div
              v-else
              class="responsive-picture-placeholder rounded"
              :style="topPlaceholder ? { backgroundImage: `url(${topPlaceholder})` } : null"
            ></div>
          </div>
        </div>
        <div class="about-value__content">
          <div class="value-copy brand-card">
            <span v-if="valueBadge" class="value-badge text-uppercase">{{ valueBadge }}</span>
            <h2 v-if="valueHeading" class="value-heading">
              {{ valueHeading }}
            </h2>
            <p v-if="valueIntro" class="value-intro">
              {{ valueIntro }}
            </p>
            <p v-if="valueSecondary" class="value-secondary">
              {{ valueSecondary }}
            </p>
            <ul v-if="valueBenefits.length" class="value-benefits">
              <li
                v-for="(benefit, idx) in valueBenefits"
                :key="idx"
                class="value-benefit brand-card"
              >
                <span
                  v-if="benefit.icon"
                  class="value-benefit-icon"
                  aria-hidden="true"
                >
                  {{ benefit.icon }}
                </span>
                <span class="value-benefit-text">
                  {{ benefit.text }}
                </span>
              </li>
            </ul>
            <div class="value-actions" v-if="hasValueActions">
              <a
                v-if="hasValueCta"
                class="primary-button value-cta"
                :href="valueCta.href"
              >
                <span class="value-cta__label">{{ valueCta.text }}</span>
              </a>
              <a
                v-if="valueDisclaimer.text && valueDisclaimer.href"
                class="value-disclaimer-link"
                :href="valueDisclaimer.href"
              >
                {{ valueDisclaimer.text }}
              </a>
            </div>
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

const aboutContent = computed(() => pageContent.value?.aboutValue || {});

const siteName = computed(() => injectedSiteData.value?.site?.title || '');

const getValueContent = (key, fallback) => {
  const value = aboutContent.value?.[key];
  return value === undefined || value === null ? fallback : value;
};

const valueBadge = computed(() => getValueContent('valueBadge', ''));
const valueHeading = computed(() => getValueContent('valueHeading', ''));
const valueIntro = computed(() => getValueContent('valueIntro', ''));
const valueSecondary = computed(() => getValueContent('valueSecondary', ''));
const valueBenefits = computed(() => {
  const benefits = getValueContent('valueBullets', []);
  if (!Array.isArray(benefits)) {
    return [];
  }
  return benefits
    .map((benefit) => {
      if (!benefit || typeof benefit !== 'object') return null;
      const text = typeof benefit.text === 'string' ? benefit.text.trim() : '';
      const icon = typeof benefit.icon === 'string' ? benefit.icon.trim() : '';
      if (!text) return null;
      return { text, icon };
    })
    .filter(Boolean);
});

const valueDisclaimer = computed(() => {
  const disclaimer = getValueContent('disclaimer', null);
  const text = disclaimer && typeof disclaimer.text === 'string' ? disclaimer.text.trim() : '';
  const href = disclaimer && typeof disclaimer.href === 'string' ? disclaimer.href.trim() : '';
  return { text, href };
});

const valueCta = computed(() => {
  const cta = getValueContent('valueCta', null);
  const text = cta && typeof cta.text === 'string' ? cta.text.trim() : '';
  const href = cta && typeof cta.href === 'string' ? cta.href.trim() : '';
  return { text, href };
});

const valueImageAlt = computed(() => {
  const alt = getValueContent('valueImageAlt', '');
  if (typeof alt === 'string' && alt.trim()) {
    return alt.trim();
  }
  return siteName.value || '';
});

const hasValueCta = computed(() => Boolean(valueCta.value.text && valueCta.value.href));
const hasValueDisclaimer = computed(() =>
  Boolean(valueDisclaimer.value.text && valueDisclaimer.value.href)
);
const hasValueActions = computed(() => hasValueCta.value || hasValueDisclaimer.value);

const hasValueProps = computed(() => {
  return Boolean(valueIntro.value && valueBenefits.value.length > 0);
});

const DEFAULT_VALUE_IMAGE_PATH = 'img/about-top';
const DEFAULT_VALUE_IMAGE_WIDTHS = [320, 900];
const DEFAULT_VALUE_IMAGE_FALLBACK = 'jpg';

const valueImagePath = computed(() => {
  const raw = getValueContent('valueImage', null);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (raw && typeof raw === 'object' && typeof raw.path === 'string' && raw.path.trim()) {
    return raw.path.trim();
  }
  return DEFAULT_VALUE_IMAGE_PATH;
});

const valueImageWidths = computed(() => {
  const raw = getValueContent('valueImage', null);
  const widths = raw && typeof raw === 'object' ? raw.widths : null;
  if (Array.isArray(widths) && widths.length) {
    return widths;
  }
  return DEFAULT_VALUE_IMAGE_WIDTHS;
});

const valueImageFallbackFormat = computed(() => {
  const raw = getValueContent('valueImage', null);
  const format = raw && typeof raw === 'object' ? raw.fallbackFormat : null;
  if (typeof format === 'string' && format.trim()) {
    return format.trim();
  }
  return DEFAULT_VALUE_IMAGE_FALLBACK;
});

const topImage = useResponsiveImage(valueImagePath, {
  widths: valueImageWidths,
  fallbackFormat: valueImageFallbackFormat,
});
const topImageHandleError = topImage.handleError;

const topImageSizes = '(min-width: 1200px) 66vw, (min-width: 992px) 60vw, 100vw';

const { isVisible: isTopImageVisible, targetRef: topImageTarget } = useLazyImage({
  rootMargin: '250px 0px',
});

const topImageSources = topImage.sources;
const topImageFallback = topImage.fallbackSrc;
const topImageFallbackSet = topImage.fallbackSrcSet;
const topPlaceholder = topImage.placeholderSrc;
</script>

<style scoped>
.about-value__grid {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-32, 32px);
}

@media (min-width: 1024px) {
  .about-value__grid {
    flex-direction: row;
    align-items: center;
    gap: clamp(32px, 6vw, 80px);
  }
}

.about-value__media,
.about-value__content {
  flex: 1 1 0;
  min-width: 0;
}

.about-value__content {
  display: flex;
}

.value-picture {
  --responsive-picture-surface: color-mix(
    in srgb,
    var(--brand-surface-card-bg, rgba(10, 10, 13, 0.94)) 90%,
    transparent
  );
  --responsive-picture-placeholder: linear-gradient(
    135deg,
    color-mix(in srgb, var(--brand-surface-card-bg, rgba(20, 18, 22, 0.55)) 80%, transparent),
    color-mix(in srgb, var(--brand-surface-card-bg, rgba(10, 10, 13, 0.75)) 65%, transparent)
  );
  box-shadow: 0 25px 60px
    color-mix(in srgb, var(--brand-surface-card-shadow, rgba(12, 9, 26, 0.45)) 100%, transparent);
}

.value-copy {
  padding: clamp(24px, 4vw, 36px);
  color: var(--ui-text-primary, var(--brand-card-text));
}

.value-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 999px;
  letter-spacing: 0.12em;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--brand-accent-electric, #ffffff) 15%, transparent);
  color: color-mix(in srgb, var(--ui-text-primary, #ffffff) 78%, transparent);
  margin-bottom: 18px;
}

.value-heading {
  margin-bottom: 16px;
  color: var(--ui-text-primary, rgba(255, 255, 255, 0.96));
  font-size: clamp(1.75rem, 4vw, 2.4rem);
  font-weight: 600;
  line-height: 1.2;
}

.value-intro,
.value-secondary {
  font-size: 16px;
  line-height: 1.6;
  margin-bottom: 18px;
  color: var(--ui-text-muted, rgba(255, 255, 255, 0.88));
}

.value-benefits {
  list-style: none;
  margin: 0 0 24px;
  padding: 0;
  display: grid;
  gap: 12px;
}

.value-benefit {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
}

.value-benefit-icon {
  font-size: 18px;
  line-height: 1;
}

.value-benefit-text {
  font-size: 15px;
  line-height: 1.5;
  color: var(--ui-text-primary, rgba(255, 255, 255, 0.92));
}

.value-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: center;
}

.value-cta {
  padding-inline: 32px;
}

.value-cta__label {
  color: #000;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.value-cta:focus-visible .value-cta__label,
.value-cta:hover .value-cta__label {
  color: #000;
}

.value-disclaimer-link {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ui-text-muted, var(--trust-accent-primary));
  text-decoration: underline;
  transition: color 0.2s ease;
}

.value-disclaimer-link:hover {
  color: var(--trust-accent-secondary, #ff2d86);
}

@media (max-width: 991px) {
  .about-value__content {
    justify-content: center;
  }
}

@media (max-width: 575px) {
  .value-benefit {
    flex-direction: row;
  }
}

</style>
