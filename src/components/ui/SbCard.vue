<template>
  <component
    :is="tag"
    class="sb-card"
    :class="[attrs.class, { 'sb-card--padded': padded }]"
    v-bind="forwardedAttrs"
  >
    <slot />
  </component>
</template>

<script setup>
import { computed, useAttrs } from 'vue';

const props = defineProps({
  tag: {
    type: String,
    default: 'div',
  },
  padded: {
    type: Boolean,
    default: true,
  },
});

const attrs = useAttrs();
const forwardedAttrs = computed(() => {
  const { class: _ignoredClass, ...rest } = attrs;
  return rest;
});
</script>

<style scoped>
.sb-card {
  background: var(--brand-surface-card-bg, #141216);
  border: 1px solid var(--brand-surface-card-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--brand-card-radius, 24px);
  box-shadow: var(--brand-surface-card-shadow, 0 8px 24px rgba(217, 22, 75, 0.18));
  backdrop-filter: blur(12px);
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}

.sb-card--padded {
  padding: 24px;
}

@media (min-width: 992px) {
  .sb-card--padded {
    padding: 32px;
  }
}
</style>
