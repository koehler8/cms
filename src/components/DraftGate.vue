<template>
  <section
    class="draft-gate"
    role="dialog"
    aria-modal="true"
    aria-labelledby="draft-gate-title"
    aria-describedby="draft-gate-description"
  >
    <div class="draft-gate-card" ref="cardRef" tabindex="-1">
      <p class="draft-gate-eyebrow">Draft</p>
      <h1 id="draft-gate-title" class="draft-gate-title">
        This page is not yet public
      </h1>
      <p id="draft-gate-description" class="draft-gate-body">
        {{ bodyText }}
      </p>
      <form class="draft-gate-form" @submit.prevent="handleSubmit" novalidate>
        <label class="draft-gate-label" for="draft-gate-password">
          Password
        </label>
        <input
          id="draft-gate-password"
          ref="inputRef"
          v-model="passwordInput"
          type="password"
          autocomplete="current-password"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :aria-invalid="hasError ? 'true' : 'false'"
          aria-describedby="draft-gate-error"
          class="draft-gate-input"
        />
        <p
          id="draft-gate-error"
          class="draft-gate-error"
          aria-live="polite"
          role="status"
        >
          {{ errorMessage }}
        </p>
        <button type="submit" class="draft-gate-submit">
          {{ submitLabel }}
        </button>
      </form>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';

const props = defineProps({
  hasPassword: {
    type: Boolean,
    default: false,
  },
  errorMessage: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['submit']);

const passwordInput = ref('');
const inputRef = ref(null);
const cardRef = ref(null);
const hasError = computed(() => Boolean(props.errorMessage));

const bodyText = computed(() =>
  props.hasPassword
    ? 'Enter the password to preview this content.'
    : 'No password is required — submit to continue.',
);

const submitLabel = computed(() => (props.hasPassword ? 'Unlock' : 'Continue'));

function handleSubmit() {
  emit('submit', passwordInput.value);
}

onMounted(() => {
  if (import.meta.env.SSR) return;
  nextTick(() => {
    inputRef.value?.focus();
  });
});
</script>

<style scoped>
.draft-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: clamp(1.5rem, 5vw, 3rem);
  background: var(--brand-surface, #f7f7f8);
  color: var(--brand-text, #1f2a44);
  font-family: var(--ui-font-body, system-ui, -apple-system, sans-serif);
}

.draft-gate-card {
  width: 100%;
  max-width: 28rem;
  padding: clamp(1.75rem, 4vw, 2.5rem);
  background: var(--brand-surface-elevated, #ffffff);
  border: 1px solid var(--brand-border, rgba(31, 42, 68, 0.12));
  border-radius: clamp(12px, 2vw, 18px);
  box-shadow: 0 18px 38px rgba(15, 22, 42, 0.08);
  outline: none;
}

.draft-gate-eyebrow {
  margin: 0 0 0.5rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--brand-text-muted, rgba(31, 42, 68, 0.6));
}

.draft-gate-title {
  margin: 0 0 0.75rem;
  font-size: clamp(1.4rem, 2.6vw, 1.75rem);
  line-height: 1.2;
  font-weight: 700;
}

.draft-gate-body {
  margin: 0 0 1.5rem;
  font-size: 1rem;
  line-height: 1.55;
  color: var(--brand-text-muted, rgba(31, 42, 68, 0.75));
}

.draft-gate-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.draft-gate-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--brand-text, #1f2a44);
}

.draft-gate-input {
  width: 100%;
  min-height: 2.75rem;
  padding: 0.65rem 0.85rem;
  font-size: 1rem;
  font-family: inherit;
  background: var(--brand-surface, #ffffff);
  color: inherit;
  border: 1px solid var(--brand-border, rgba(31, 42, 68, 0.25));
  border-radius: var(--brand-input-radius, 8px);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.draft-gate-input:focus-visible {
  outline: 2px solid var(--brand-primary, #1f2a44);
  outline-offset: 2px;
  border-color: var(--brand-primary, #1f2a44);
}

.draft-gate-input[aria-invalid='true'] {
  border-color: var(--brand-criticalText, #b3261e);
}

.draft-gate-error {
  min-height: 1.25rem;
  margin: 0;
  font-size: 0.85rem;
  color: var(--brand-criticalText, #b3261e);
}

.draft-gate-submit {
  margin-top: 0.5rem;
  min-height: 2.75rem;
  padding: 0.7rem 1.4rem;
  font-size: 1rem;
  font-family: inherit;
  font-weight: 600;
  color: var(--brand-primary-cta-text, #ffffff);
  background: var(--brand-primary-cta, var(--brand-primary, #1f2a44));
  border: none;
  border-radius: var(--brand-button-radius, 10px);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.draft-gate-submit:hover {
  transform: translateY(-1px);
}

.draft-gate-submit:focus-visible {
  outline: 2px solid var(--brand-primary, #1f2a44);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .draft-gate-submit,
  .draft-gate-input {
    transition: none;
  }
  .draft-gate-submit:hover {
    transform: none;
  }
}
</style>
