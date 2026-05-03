<template>
  <IntroGate
    :enabled="introGateEnabled"
    v-bind="introGateProps"
  />
  <main>
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

<script setup>
import { computed, nextTick, provide, watch } from 'vue';

import ComingSoonModal from '../components/ComingSoonModal.vue';
import IntroGate from '../components/IntroGate.vue';

import { registry } from '../utils/componentRegistry.js';
import { usePageConfig } from '../composables/usePageConfig.js';
import { useComponentResolver } from '../composables/useComponentResolver.js';
import { usePageMeta } from '../composables/usePageMeta.js';
import { useIntroGate } from '../composables/useIntroGate.js';
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

