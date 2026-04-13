<template>
  <teleport to="body">
    <div
      v-if="open"
      class="coming-soon-overlay"
      role="presentation"
      @keydown.esc.prevent="emitClose"
    >
      <div
        class="coming-soon-backdrop"
        @click.self="emitClose"
      >
        <div
          class="coming-soon-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="dialogTitleId"
          :aria-describedby="dialogDescriptionId"
          ref="dialogRef"
          tabindex="-1"
          @keydown.esc.prevent.stop="emitClose"
        >
          <button
            type="button"
            class="coming-soon-close"
            @click="emitClose"
            aria-label="Close"
          >
            &times;
          </button>
          <h2 class="coming-soon-title" :id="dialogTitleId">
            {{ title }}
          </h2>
          <p class="coming-soon-message" :id="dialogDescriptionId">
            {{ message }}
          </p>
          <button
            type="button"
            class="coming-soon-cta"
            @click="emitClose"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Coming Soon',
  },
  message: {
    type: String,
    default: "We're putting the finishing touches on this experience. Check back soon!",
  },
});

const emit = defineEmits(['close']);

const dialogRef = ref(null);
const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const dialogTitleId = computed(() => 'coming-soon-title');
const dialogDescriptionId = computed(() => 'coming-soon-message');

const emitClose = () => {
  emit('close');
};

const trapFocus = (event) => {
  if (!props.open) return;
  if (typeof document === 'undefined') return;
  if (event.key !== 'Tab') return;
  const dialogEl = dialogRef.value;
  if (!dialogEl) return;
  const focusable = dialogEl.querySelectorAll(focusableSelector);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document === 'undefined') return;
    if (isOpen) {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          dialogRef.value?.focus();
        });
      } else {
        dialogRef.value?.focus();
      }
      document.addEventListener('keydown', trapFocus);
    } else {
      document.removeEventListener('keydown', trapFocus);
    }
  }
);

onMounted(() => {
  if (typeof document === 'undefined') return;
  if (props.open) {
    document.addEventListener('keydown', trapFocus);
  }
});

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return;
  document.removeEventListener('keydown', trapFocus);
});
</script>

<style scoped>
.coming-soon-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
}

.coming-soon-backdrop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: rgba(15, 15, 20, 0.85);
  padding: 1.5rem;
}

.coming-soon-dialog {
  position: relative;
  max-width: 28rem;
  width: 100%;
  padding: 2.5rem 2rem 2rem;
  border-radius: var(--brand-modal-radius, 24px);
  background: var(
    --brand-modal-surface,
    linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(240, 240, 255, 0.92))
  );
  box-shadow: var(--brand-modal-shadow, 0 18px 48px rgba(8, 4, 18, 0.35));
  text-align: center;
  color: var(--brand-fg-100, #0a0a0d);
}

.coming-soon-title {
  margin: 0 0 1rem;
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  font-family: 'Space Grotesk', 'Inter', sans-serif;
  font-weight: 700;
  color: var(--brand-fg-100, #0a0a0d);
}

.coming-soon-message {
  margin: 0 0 1.75rem;
  font-size: clamp(1rem, 2.4vw, 1.125rem);
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  color: var(--brand-fg-200, rgba(8, 8, 18, 0.75));
}

.coming-soon-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 8rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--brand-button-radius, 14px);
  border: none;
  font-weight: 600;
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  color: var(--brand-primary-cta-text, #0b0418);
  background: var(
    --brand-primary-cta-gradient,
    linear-gradient(90deg, #ff42a5 0%, #7f5dff 50%, #48d5ff 100%)
  );
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
}

.coming-soon-cta:hover,
.coming-soon-cta:focus {
  opacity: 0.92;
  transform: translateY(-1px);
}

.coming-soon-cta:focus {
  outline: 2px solid #111111;
  outline-offset: 2px;
}

.coming-soon-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: transparent;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: #888;
  padding: 0.25rem;
}

.coming-soon-close:hover,
.coming-soon-close:focus {
  color: #111111;
}
</style>
