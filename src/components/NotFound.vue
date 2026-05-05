<template>
  <section class="not-found" aria-labelledby="not-found-heading">
    <p class="not-found__eyebrow" aria-hidden="true">404</p>
    <h1 id="not-found-heading" class="not-found__title">{{ heading }}</h1>
    <p class="not-found__body">{{ body }}</p>
    <a class="not-found__home" :href="homeHref">{{ homeLabel }}</a>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue';

const pageContent = inject('pageContent', null);
const siteData = inject('siteData', null);

const config = computed(() => {
  const fromShared = siteData?.value?.shared?.content?.notFound;
  const fromPage = pageContent?.value?.notFound;
  return { ...(fromShared || {}), ...(fromPage || {}) };
});

const heading = computed(() => config.value.heading || 'Page not found');
const body = computed(
  () => config.value.body || "We couldn't find the page you're looking for.",
);
const homeLabel = computed(() => config.value.homeLabel || 'Return home');
const homeHref = computed(() => config.value.homeHref || '/');
</script>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: clamp(2rem, 6vw, 4rem) clamp(1rem, 4vw, 2rem);
  text-align: center;
  color: var(--brand-text, #1f2a44);
  background: var(--brand-surface, transparent);
  font-family: var(--ui-font-body, system-ui, -apple-system, sans-serif);
}

.not-found__eyebrow {
  margin: 0 0 0.25rem;
  font-size: clamp(2.5rem, 8vw, 4rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--brand-text-muted, rgba(31, 42, 68, 0.55));
}

.not-found__title {
  margin: 0 0 0.75rem;
  font-size: clamp(1.5rem, 4vw, 2.25rem);
  font-weight: 700;
  line-height: 1.2;
}

.not-found__body {
  margin: 0 0 1.5rem;
  max-width: 32rem;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--brand-text-muted, rgba(31, 42, 68, 0.7));
}

.not-found__home {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.7rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  text-decoration: none;
  color: var(--brand-primary-cta-text, #ffffff);
  background: var(--brand-primary-cta, var(--brand-primary, #1f2a44));
  border-radius: var(--brand-button-radius, 10px);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.not-found__home:hover {
  transform: translateY(-1px);
}

.not-found__home:focus-visible {
  outline: 2px solid var(--brand-primary, #1f2a44);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .not-found__home {
    transition: none;
  }
  .not-found__home:hover {
    transform: none;
  }
}
</style>
