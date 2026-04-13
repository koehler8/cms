<template>
  <component
    :is="rootTag"
    class="skeleton-pulse"
    :class="{ 'skeleton-pulse--inline': inline }"
    v-bind="rootAttrs"
  >
    <span class="skeleton-pulse__shimmer" :style="shimmerStyle" aria-hidden="true"></span>
    <span v-if="srText" class="skeleton-pulse__sr">{{ srText }}</span>
  </component>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  width: {
    type: String,
    default: '100%',
  },
  height: {
    type: String,
    default: '1rem',
  },
  radius: {
    type: String,
    default: '999px',
  },
  inline: {
    type: Boolean,
    default: false,
  },
  label: {
    type: String,
    default: '',
  },
});

const srText = computed(() =>
  typeof props.label === 'string' ? props.label.trim() : ''
);
const hasLabel = computed(() => srText.value.length > 0);
const rootTag = computed(() => (props.inline ? 'span' : 'div'));
const shimmerStyle = computed(() => ({
  width: props.width,
  minWidth: props.width,
  height: props.height,
  borderRadius: props.radius,
}));
const rootAttrs = computed(() =>
  hasLabel.value
    ? { role: 'status', 'aria-live': 'polite' }
    : { 'aria-hidden': 'true' }
);
</script>

<style scoped>
.skeleton-pulse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.skeleton-pulse--inline {
  display: inline-flex;
}

.skeleton-pulse__shimmer {
  display: block;
  position: relative;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    rgba(32, 24, 39, 0.4) 0%,
    rgba(39, 243, 255, 0.28) 45%,
    rgba(255, 45, 134, 0.3) 60%,
    rgba(32, 24, 39, 0.4) 100%
  );
  background-size: 200% 100%;
  animation: skeletonPulse 1.6s ease-in-out infinite;
  box-shadow:
    0 0 12px rgba(39, 243, 255, 0.18),
    0 0 24px rgba(255, 45, 134, 0.12);
}

.skeleton-pulse__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes skeletonPulse {
  0% {
    background-position: 100% 0;
  }
  50% {
    background-position: 0 0;
  }
  100% {
    background-position: 100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-pulse__shimmer {
    animation: none;
    background-position: 50% 0;
  }
}
</style>
