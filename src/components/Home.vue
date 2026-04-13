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
    <div
      v-if="showLoadingIndicator"
      class="page-loading-placeholder"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
    <div
      v-else-if="loadErrorMessage"
      class="page-error-message"
      role="alert"
    >
      {{ loadErrorMessage }}
    </div>
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

const showLoadingIndicator = computed(() => isLoading.value && componentKeys.value.length === 0 && !loadError.value);
const loadErrorMessage = computed(() => loadError.value ? (loadError.value.message || 'Unable to load page content.') : '');

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

<style scoped>
.page-loading-placeholder,
.page-error-message {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  font-size: 1.125rem;
  font-weight: 600;
  color: #111;
  text-align: center;
}

.page-error-message {
  color: #b00020;
}
</style>
