<template>
<section
  id="promo"
  ref="heroSection"
  :class="promoSectionClasses"
  :style="promoBackgroundStyle"
>
    <div class="container text-center hero-content hero-inner">
      <div class="hero-eyebrow fade-up-in js-scroll-fade" style="--fade-up-delay: 0s">
        <p
          :class="[
            'h4',
            'text-uppercase',
            'section-eyebrow-divider',
            'hero-eyebrow__text',
          ]"
        >
          {{ tagLine }}
        </p>
      </div>
      <h1
        :class="[
          'display-heading',
          'text-uppercase',
          'hero-headline',
          'fade-up-in',
          'js-scroll-fade'
        ]"
        style="--fade-up-delay: 0.1s"
      >
        <span
          v-for="(part, index) in heroHeadlineParts"
          :key="`${part}-${index}`"
          :class="[
            'display-heading__part',
            { 'display-heading__part--nowrap': index === 0 }
          ]"
        >
          {{ part }}
        </span>
      </h1>
      <div
        class="hero-cta-stack fade-up-in js-scroll-fade"
        style="--fade-up-delay: 0.2s"
      >
        <a
          v-for="(action, idx) in promoActions"
          :key="idx"
          :class="buildPromoActionClasses(action)"
          :href="action.href"
          :data-target="isComingSoonAction(action.href) ? null : action.href"
          @click="handlePromoActionClick($event, action)"
        >
          {{ action.text }}
        </a>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';
import { useComingSoonInterstitial } from '../composables/useComingSoonInterstitial.js';
import { usePromoBackgroundStyles } from '../composables/usePromoBackgroundStyles.js';
import { trackEvent } from '../utils/analytics.js';
import { useComingSoonResolver } from '../composables/useComingSoonConfig.js';
import { useResponsiveImage } from '../utils/imageSources.js';
import { registerScrollReveal } from '../utils/useScrollReveal.js';

const { openComingSoon } = useComingSoonInterstitial();

const pageContent = inject('pageContent', ref({}));
const siteData = inject('siteData', ref({}));
const { resolve: resolveComingSoon, isComingSoonAction } = useComingSoonResolver(pageContent);

const promoData = computed(() => pageContent.value?.promo || {});

const tagLine = computed(() => promoData.value?.tagLine || '');
const siteName = computed(() => promoData.value?.mainText || '');
const promoActions = computed(() =>
  (Array.isArray(promoData.value?.actions) ? promoData.value.actions : []).map(
    (action, index) => normalizePromoAction(action, index)
  )
);

const heroHeadlineParts = computed(() => {
  const value = siteName.value || '';
  if (!value.includes('.')) {
    return [value];
  }
  const segments = value.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return [value];
  return segments.map((segment, index) => (index < segments.length - 1 ? `${segment}.` : segment));
});

const promoImageSet = useResponsiveImage('img/promo', {
  widths: [960, 1440, 1920],
  fallbackFormat: 'jpg',
});

const heroSection = ref(null);
const HERO_SCROLL_MARGIN = 32;
const HERO_SMALL_SCREEN_QUERY = '(max-width: 640px)';

const promoSectionClasses = computed(() => [
  'promo-surface',
  'section-shell',
  'hero-shell',
]);

const promoBackgroundStyle = usePromoBackgroundStyles({
  imageSet: promoImageSet,
});

onMounted(() => {
  if (!heroSection.value) return;
  const targets = heroSection.value.querySelectorAll('.js-scroll-fade');
  registerScrollReveal(targets);
});

function normalizePromoAction(entry, index) {
  const action = entry && typeof entry === 'object' ? { ...entry } : {};
  action.variant = resolveActionVariant(action, index);
  return action;
}

function resolveActionVariant(action, index) {
  const style = typeof action?.style === 'string' ? action.style.trim().toLowerCase() : '';
  if (style === 'link' || style === 'text') {
    return 'link';
  }
  if (style === 'dark' || style === 'primary' || style === 'solid') {
    return 'primary';
  }
  if (style === 'light' || style === 'secondary' || style === 'outline' || style === 'ghost') {
    return 'secondary';
  }
  return index === 0 ? 'primary' : 'secondary';
}

function buildPromoActionClasses(action = {}) {
  const variant = action.variant || 'secondary';
  const classes = [];
  if (variant === 'link') {
    classes.push('action-link');
  } else {
    classes.push('action-pill');
    if (variant === 'primary') {
      classes.push('primary-button');
    } else {
      classes.push('action-pill--secondary');
    }
  }
  return classes;
}

function handlePromoActionClick(event, action) {
  if (!event) return;

  const label = (action?.text ?? '').toString();
  const trimmedLabel = label.trim();

  const href = (action?.href ?? '').toString().trim();

  const modalPayload = resolveComingSoon({
    href,
  });
  if (modalPayload) {
    event.preventDefault();
    openComingSoon(modalPayload);
    trackEvent('coming_soon_interstitial_shown', {
      trigger: 'promo-action',
      label: trimmedLabel ? trimmedLabel.toLowerCase() : 'coming-soon',
    });
    return;
  }

  if (shouldHandleAnchorScroll(href)) {
    event.preventDefault();
    scrollToPromoTarget(href);
  }
}

function shouldHandleAnchorScroll(href) {
  if (typeof href !== 'string') return false;
  const trimmed = href.trim();
  if (!trimmed.length) return false;
  return trimmed.startsWith('#') && trimmed.length > 1;
}

function scrollToPromoTarget(targetSelector) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!targetSelector) return;
  const element = document.querySelector(targetSelector);
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const headerOffset = getHeaderOffset();
  const isCompact = window.matchMedia && window.matchMedia(HERO_SMALL_SCREEN_QUERY).matches;
  const scrollMargin = isCompact ? 0 : HERO_SCROLL_MARGIN;
  const targetTop = Math.max(rect.top + window.pageYOffset - headerOffset - scrollMargin, 0);

  window.scrollTo({
    top: targetTop,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getHeaderOffset() {
  if (typeof document === 'undefined') return 0;
  const header = document.getElementById('js-header');
  if (!header) return 0;
  return header.offsetHeight || 0;
}
</script>

<style scoped>

.hero-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh + 60px);
  padding-block: clamp(96px, 18vh, 200px);
}

.hero-content {
  position: relative;
  z-index: 1;
}

.hero-inner {
  width: min(960px, 90vw);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ui-space-16, 16px);
  text-align: center;
}

.hero-eyebrow {
  margin-bottom: var(--ui-space-16, 16px);
}

.hero-eyebrow__text {
  display: inline-block;
  font-weight: 600;
  letter-spacing: 0.12em;
  font-size: clamp(1.1rem, 1.5vw, 1.55rem);
  line-height: 1.35;
  color: var(--hero-eyebrow-color, var(--brand-hero-text-on-dark, var(--brand-hero-text, #f0eaf3)));
  border-bottom: 1px solid currentColor;
  margin: 0;
}

.hero-headline {
  font-weight: 700;
  font-size: clamp(2.1rem, 4.6vw, 3.5rem);
  line-height: 1.08;
  margin-bottom: clamp(18px, 2.5vw, 28px);
  letter-spacing: 0.04em;
  color: var(--hero-text-color, var(--brand-hero-text-on-dark, var(--brand-hero-text, #f0eaf3)));
}

.promo-surface {
  position: relative;
  min-height: var(--promo-surface-min-height, calc(100vh + 75px));
  background: var(
    --promo-surface-bg,
    var(--hero-surface-bg, var(--theme-body-background, #060212))
  );
  background-repeat: no-repeat;
  background-size: cover;
  background-position: center;
}

.hero-cta-stack {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, max-content));
  justify-content: center;
  justify-items: center;
  column-gap: 20px;
  row-gap: 16px;
  margin-bottom: var(--ui-space-24, 24px);
  max-width: min(960px, 100%);
  margin-inline: auto;
}

.hero-cta-stack :deep(.primary-button),
.hero-cta-stack :deep(.action-pill) {
  width: auto;
  min-width: 170px;
  padding: 0.75rem 1.8rem;
  min-height: 46px;
  font-size: 0.88rem;
  letter-spacing: 0.04em;
}

@media (max-width: 480px) {
  .hero-headline {
    font-size: clamp(2rem, 9vw, 3rem);
  }
}

@media (max-width: 640px) {
  .hero-cta-stack {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 14px;
  }

  .hero-cta-stack :deep(.primary-button),
  .hero-cta-stack :deep(.action-pill) {
    width: 100%;
    padding: 0.7rem 1.1rem;
    min-height: 42px;
    font-size: 0.84rem;
  }
}

</style>
