<template>
  <button
    type="button"
    class="ui-backtotop"
    :class="{ 'ui-backtotop--visible': isVisible }"
    aria-label="Back to top"
    @click="scrollToTop"
  >
    <span class="ui-backtotop__icon" aria-hidden="true">↑</span>
  </button>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

const isVisible = ref(false);

const handleScroll = () => {
  if (typeof window === 'undefined') return;
  isVisible.value = window.scrollY > 400;
};

const scrollToTop = () => {
  if (typeof window === 'undefined') return;
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
  });
};

onMounted(() => {
  handleScroll();
  window.addEventListener('scroll', handleScroll, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>
