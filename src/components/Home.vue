<template>
  <template v-if="isDraft && !isUnlocked">
    <DraftGate
      :has-password="hasPassword"
      :error-message="errorMessage"
      @submit="attemptUnlock"
    />
  </template>
  <template v-else>
    <a class="cms-skip-link" href="#main-content">Skip to main content</a>
    <IntroGate
      :enabled="introGateEnabled"
      v-bind="introGateProps"
    />
    <main id="main-content" tabindex="-1">
      <component
        v-for="entry in loadedComponents"
        :is="entry.component"
        :key="entry.key"
        v-bind="entry.props"
      />
    </main>
    <ComingSoonModal
      :open="isComingSoonVisible"
      :title="comingSoonTitle"
      :message="comingSoonMessage"
      @close="closeComingSoon"
    />
  </template>
</template>

<script setup>
import { computed, nextTick, provide, watch } from 'vue';

import ComingSoonModal from '../components/ComingSoonModal.vue';
import DraftGate from '../components/DraftGate.vue';
import IntroGate from '../components/IntroGate.vue';

import { registry } from '../utils/componentRegistry.js';
import { usePageConfig } from '../composables/usePageConfig.js';
import { useComponentResolver } from '../composables/useComponentResolver.js';
import { usePageMeta } from '../composables/usePageMeta.js';
import { useIntroGate } from '../composables/useIntroGate.js';
import { useDraftGate } from '../composables/useDraftGate.js';
import { useEngagementTracking } from '../composables/useEngagementTracking.js';
import { useComingSoonInterstitial } from '../composables/useComingSoonInterstitial.js';

const props = defineProps({
  pageId: {
    type: String,
    default: null,
  },
  pagePath: {
    type: String,
    default: null,
  },
  locale: {
    type: String,
    default: null,
  },
});

const {
  siteData,
  pageContent,
  currentPage,
  componentKeys,
  isLoading,
  loadError,
} = usePageConfig({
  pageId: () => props.pageId,
  pagePath: () => props.pagePath,
  locale: () => props.locale,
});

const { loadedComponents } = useComponentResolver({
  componentKeys,
  pageContent,
  currentPage,
  registry,
});

const { introGateEnabled, introGateProps } = useIntroGate({ siteData, pageContent });

const {
  isDraft,
  isUnlocked,
  hasPassword,
  errorMessage,
  attemptUnlock,
} = useDraftGate({ siteData, currentPage });

usePageMeta({ siteData, currentPage });

const {
  isComingSoonVisible,
  comingSoonTitle,
  comingSoonMessage,
  closeComingSoon,
} = useComingSoonInterstitial();

const { refreshVisibilityTargets, resetEngagementTracking } = useEngagementTracking({
  getContext: () => ({
    page_id: currentPage.value.id || '',
    locale: props.locale || '',
  }),
});

provide('siteData', siteData);
provide('pageContent', pageContent);
provide('pageConfig', currentPage);
provide('currentPageId', computed(() => currentPage.value.id));

// Loading + error state are exposed via inject so sites can build their
// own preloader / error surface as a component (e.g. site/components/
// Preloader.vue or the bundled Preloader). Home itself no longer renders
// any built-in placeholder UI — sites that want one opt in by listing a
// preloader component in their pages/{pageId}.json `components[]`.
provide('pageIsLoading', isLoading);
provide('pageLoadError', loadError);

watch(componentKeys, async () => {
  await nextTick();
  refreshVisibilityTargets();
}, { flush: 'post' });

watch(
  () => currentPage.value.id,
  async () => {
    await nextTick();
    resetEngagementTracking();
    refreshVisibilityTargets();
  },
  { immediate: true, flush: 'post' },
);
</script>

<style>
/* Visually-hidden until focused. The skip link is the first focusable
   element on the page; pressing Tab once reveals it and Enter jumps
   focus past the sticky header into <main>. WCAG 2.4.1 (Bypass Blocks). */
.cms-skip-link {
  position: absolute;
  top: 0;
  left: 0;
  padding: 12px 20px;
  background: #ffffff;
  color: #1f2a44;
  border: 2px solid #1f2a44;
  border-radius: 0 0 8px 0;
  font-family: var(--ui-font-body, system-ui, -apple-system, sans-serif);
  font-weight: 600;
  text-decoration: none;
  z-index: 9999;
  transform: translateY(-100%);
  transition: transform 0.15s ease;
}
.cms-skip-link:focus {
  transform: translateY(0);
  outline: 2px solid #1f2a44;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .cms-skip-link { transition: none; }
}

/* When the skip link sends focus to <main>, browsers don't render an
   outline on the [tabindex="-1"] element by default — strip it so the
   page doesn't get an unexpected ring around its main region. */
#main-content:focus { outline: none; }

/* Sticky header offset for in-page anchor jumps and skip-link landing.
   Without this, the focused element is hidden under the sticky header
   (fails 2.4.11 Focus Not Obscured). */
html { scroll-padding-top: 88px; }
</style>

