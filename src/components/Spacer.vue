<template>
  <div class="ui-spacer" aria-hidden="true" :style="spacerStyle"></div>
</template>

<script setup>
import { computed } from 'vue';

// Vertical spacing utility. The numeric-suffixed names (Spacer15/30/40/60)
// used in pages/*.json components[] are thin aliases wrapping this with a
// fixed size.
const props = defineProps({
  size: {
    type: [Number, String],
    default: 30,
  },
});

const spacerStyle = computed(() => {
  const parsed = Number.parseInt(props.size, 10);
  const px = Number.isFinite(parsed) && parsed >= 0 ? parsed : 30;
  return { '--ui-spacer-size': `${px}px` };
});
</script>
