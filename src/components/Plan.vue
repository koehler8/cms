<template>
  <section id="plan" class="section-shell plan-section" data-analytics-section="plan">
    <div class="container">
      <header class="plan-heading text-center">
        <div class="plan-heading__divider" aria-hidden="true"></div>
        <h2 class="plan-heading__title text-uppercase">{{ planTitle }}</h2>
        <p v-if="planSubtitle" class="plan-heading__subtitle mb-0 text-muted">
          {{ planSubtitle }}
        </p>
      </header>
      <div class="plan-grid">
        <div
          v-for="(item, idx) in planItems"
          :key="idx"
          class="plan-column"
        >
          <div class="plan-card text-center">
            <span
              class="plan-step-icon"
            >
              {{ item.step }}
            </span>
            <h3 class="plan-card__title">{{ item.title }}</h3>
            <p class="plan-card__description mb-0">{{ item.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, ref } from 'vue';

const pageContent = inject('pageContent', ref({}));

const planData = computed(() => pageContent.value?.plan || {});

const planTitle = computed(() => planData.value?.title || 'The Plan');
const planSubtitle = computed(() => planData.value?.subtitle || '');

const planItems = computed(() =>
  Array.isArray(planData.value?.items) ? planData.value.items : []
);
</script>

<style scoped>
.plan-section {
  background: var(--plan-section-bg, transparent);
}

.plan-heading {
  max-width: 640px;
  margin: 0 auto var(--ui-space-32, 32px);
}

.plan-heading__divider {
  width: 60px;
  height: 3px;
  margin: 0 auto var(--ui-space-16, 16px);
  background: var(--plan-heading-divider, var(--brand-accent-electric, #4f6cf0));
  border-radius: 999px;
}

.plan-heading__title {
  font-weight: 600;
  font-size: clamp(2rem, 4vw, 2.6rem);
  margin-bottom: var(--ui-space-12, 12px);
}

.plan-heading__subtitle {
  font-size: 1rem;
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ui-space-24, 24px);
}

.plan-card {
  padding: var(--ui-space-24, 24px);
  border-radius: var(--brand-card-radius, 24px);
  border: 1px solid color-mix(in srgb, var(--brand-surface-card-border, rgba(255, 255, 255, 0.12)) 100%, transparent);
  background: var(--plan-card-bg, color-mix(in srgb, var(--brand-bg-900, #05050a) 85%, transparent));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ui-space-16, 16px);
  min-height: 100%;
}

.plan-step-icon {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  /* 3:1+ against the dark plan-card surface (WCAG 1.4.11). */
  border: 3px solid var(--plan-step-border, var(--brand-plan-step-ring, rgba(255, 255, 255, 0.5)));
  color: var(--plan-step-color, #ffffff);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1.2rem;
}

.plan-card__title {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0;
  /* Dark plan-card surface needs light text. Don't fall through to
     --ui-text-primary (dark) — that's the FOUC trap that bit FooterMinimal. */
  color: var(--plan-card-title, var(--brand-plan-card-text, #ffffff));
}

.plan-card__description {
  color: var(--plan-card-description, var(--brand-plan-card-muted-text, #c8c2cf));
}
</style>
