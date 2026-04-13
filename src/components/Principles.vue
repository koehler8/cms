<template>
  <section id="principles" class="section-shell principles-section" data-analytics-section="principles">
    <div class="container">
      <header class="section-header text-center">
        <div class="section-heading">
          <h2 class="display-heading principles-heading">{{ principlesTitle }}</h2>
          <span class="section-divider" aria-hidden="true"></span>
        </div>
        <p v-if="principlesSubtitle" class="section-description">{{ principlesSubtitle }}</p>
      </header>
      <div class="principles-list-wrapper">
        <ul class="principles-list">
          <li
            v-for="(principle, idx) in principlesList"
            :key="idx"
            class="principles-list__item"
          >
            {{ principle }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, ref } from 'vue';

const pageContent = inject('pageContent', ref({}));

const principlesData = computed(() => pageContent.value?.principles || {});

const principlesTitle = computed(() => principlesData.value?.title || 'Principles');
const principlesSubtitle = computed(() => principlesData.value?.subtitle || '');
const principlesList = computed(() =>
  Array.isArray(principlesData.value?.items) ? principlesData.value.items : []
);
</script>

<style scoped>
.principles-heading {
  font-weight: 700;
  letter-spacing: 0.18em;
}

.principles-list-wrapper {
  display: flex;
  justify-content: center;
}

.principles-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 1rem;
  line-height: 1.8;
  color: var(--ui-text-primary, var(--brand-fg-100));
}

.principles-list__item {
  padding-left: 0;
}
</style>
