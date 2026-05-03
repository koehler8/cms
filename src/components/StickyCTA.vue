<template>
  <transition name="slide-up">
    <div
      v-if="isVisible"
      class="sticky-cta"
      role="complementary"
      aria-label="Primary site action"
    >
      <button
        type="button"
        class="sticky-cta__button"
        role="button"
        :aria-label="buttonLabel"
        @click="handleClick"
      >
        {{ buttonLabel }}
      </button>
    </div>
  </transition>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue';
import { trackEvent } from '../utils/analytics.js';
import { resolveCtaCopy } from '../utils/ctaCopy.js';

const MOBILE_MAX_WIDTH = 820; // px
const SCROLL_THRESHOLD = 0.25; // 25%
const DEFAULT_LABEL = 'Get Started';

const pageContent = inject('pageContent', ref({}));
const siteData = inject('siteData', ref({}));

const ctaConfig = computed(() => pageContent.value?.stickyCta || {});
const targetSelector = computed(() => ctaConfig.value?.target || '');
const buttonLabel = computed(() => {
  const fallback = ctaConfig.value?.label || DEFAULT_LABEL;
  const ctaType =
    typeof ctaConfig.value?.ctaType === 'string' && ctaConfig.value.ctaType.trim()
      ? ctaConfig.value.ctaType.trim()
      : 'stickyPrimary';
  return resolveCtaCopy(siteData, ctaType, fallback);
});

const isVisible = ref(false);
let lastKnownScrollRatio = 0;
let scrollRaf = null;
const hasTrackedImpression = ref(false);
const isTargetVisible = ref(false);
let targetObserver = null;
let observerRetryId = null;

function withinMobileViewport() {
  return window.innerWidth <= MOBILE_MAX_WIDTH;
}

function calculateScrollRatio() {
  const scrollTop = window.scrollY || window.pageYOffset || 0;
  const docHeight = document.documentElement.scrollHeight;
  const windowHeight = window.innerHeight || 1;
  const availableScroll = Math.max(docHeight - windowHeight, 1);
  return scrollTop / availableScroll;
}

function updateVisibility() {
  if (!withinMobileViewport()) {
    isVisible.value = false;
    return;
  }

  if (isTargetVisible.value) {
    isVisible.value = false;
    return;
  }

  const ratio = calculateScrollRatio();
  lastKnownScrollRatio = ratio;
  isVisible.value = ratio >= SCROLL_THRESHOLD;
}

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = null;
    updateVisibility();
  });
}

function handleClick() {
  trackEvent('sticky_cta_clicked', {
    target: targetSelector.value,
  });

  if (typeof window !== 'undefined') {
    const target = resolveTargetElement();
    if (target) {
      scrollTargetWithOffset(target);
    }
  }
}

function disconnectObserver() {
  if (targetObserver) {
    targetObserver.disconnect();
    targetObserver = null;
  }
  if (observerRetryId && typeof window !== 'undefined') {
    window.clearTimeout(observerRetryId);
    observerRetryId = null;
  }
}

function handleIntersection(entries) {
  const entry = entries && entries[0];
  if (!entry) return;
  const intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
  isTargetVisible.value = intersecting;
  if (intersecting) {
    isVisible.value = false;
  } else {
    updateVisibility();
  }
}

function observeTarget() {
  disconnectObserver();
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const target = document.querySelector(targetSelector.value);
  if (!target) {
    observerRetryId = window.setTimeout(observeTarget, 400);
    return;
  }

  targetObserver = new IntersectionObserver(handleIntersection, {
    threshold: [0, 0.1],
    rootMargin: '0px 0px -20% 0px',
  });
  targetObserver.observe(target);
}

onMounted(() => {
  if (typeof window === 'undefined') return;
  observeTarget();
  updateVisibility();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateVisibility, { passive: true });

  watch(
    isVisible,
    (visible) => {
      if (visible && !hasTrackedImpression.value) {
        hasTrackedImpression.value = true;
        trackEvent('sticky_cta_shown', {
          target: targetSelector.value,
          scroll_ratio: Number.isFinite(lastKnownScrollRatio) ? Number(lastKnownScrollRatio.toFixed(3)) : null,
        });
      }
    },
    { immediate: true }
  );
});

watch(
  targetSelector,
  () => {
    if (typeof window === 'undefined') return;
    observeTarget();
  },
  { flush: 'post' }
);

onUnmounted(() => {
  if (typeof window === 'undefined') return;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', updateVisibility);
  if (scrollRaf) {
    window.cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
  disconnectObserver();
});

function resolveTargetElement() {
  if (typeof document === 'undefined') return null;
  const selector = (targetSelector.value || '').trim();
  if (!selector) return null;
  return document.querySelector(selector);
}

function scrollTargetWithOffset(target) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !target) return false;
  const header = document.getElementById('js-header');
  const headerOffset = header ? header.offsetHeight || 0 : 0;
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rect = target.getBoundingClientRect();
  const currentScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
  const offset = Math.max(rect.top + currentScroll - headerOffset - 16, 0);
  window.scrollTo({ top: offset, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  return true;
}
</script>

<style scoped>
.sticky-cta {
  position: fixed;
  left: 0;
  right: 0;
  bottom: env(safe-area-inset-bottom);
  padding: 12px clamp(16px, 5vw, 32px);
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 1050;
}

.sticky-cta__button {
  pointer-events: auto;
  min-height: 48px;
  padding: 14px 24px;
  border: none;
  border-radius: var(--brand-button-radius, 14px);
  /* The default 3-stop gradient previously failed contrast at the mid stop
     (#0a0a0d on #9a2eff = 3.96:1). Mid stop darkened to #7e23d5 → 5.34:1
     with the dark text. Sites overriding --brand-primary-cta-gradient
     are responsible for verifying contrast against --brand-primary-cta-text. */
  background: var(
    --brand-primary-cta-gradient,
    linear-gradient(135deg, #ff2d86 0%, #7e23d5 55%, #2bb8d9 100%)
  );
  color: var(--brand-primary-cta-text, #0a0a0d);
  font-size: clamp(0.95rem, 2.5vw, 1.05rem);
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: var(--brand-primary-cta-shadow, 0 18px 40px rgba(255, 60, 125, 0.45));
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  white-space: nowrap;
}

.sticky-cta__button:active {
  transform: scale(0.98);
}

.sticky-cta__button:hover {
  transform: var(--brand-primary-cta-hover-translate, translateY(-2px));
  box-shadow: var(--brand-primary-cta-hover-shadow, 0 20px 44px rgba(255, 60, 125, 0.55));
}

.sticky-cta__button:focus-visible {
  outline: 2px solid var(--brand-accent-electric, #27f3ff);
  outline-offset: 3px;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(30%);
  opacity: 0;
}
</style>
