<template>
  <teleport to="body">
    <div
      v-if="isOpen"
      class="intro-gate-overlay"
      role="presentation"
    >
      <div
        class="intro-gate-backdrop"
        @click.self="handleDismiss('backdrop')"
      >
        <div
          class="intro-gate-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="dialogTitleId"
          :aria-describedby="dialogDescriptionId"
          ref="dialogRef"
          tabindex="-1"
        >
          <span class="intro-gate-glow" aria-hidden="true"></span>
          <button
            type="button"
            class="intro-gate-close"
            @click="handleDismiss('close-button')"
            :aria-label="closeButtonAriaLabel"
          >
            &times;
          </button>
          <p class="intro-gate-eyebrow">{{ eyebrowText }}</p>
          <h2 :id="dialogTitleId" class="intro-gate-title">
            {{ titleText }}
          </h2>
          <p :id="dialogDescriptionId" class="intro-gate-body">
            {{ bodyText }}
          </p>
          <div class="intro-gate-actions">
            <button
              type="button"
              class="intro-gate-primary"
              @click="handlePrimaryClick"
            >
              {{ primaryLabelText }}
            </button>
            <a
              class="intro-gate-secondary"
              :href="secondaryHref"
              @click="handleDismiss('learn-more')"
            >
              {{ secondaryLabelText }}
            </a>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { trackEvent } from '../utils/analytics.js';

const props = defineProps({
  enabled: {
    type: Boolean,
    default: false,
  },
  eyebrow: {
    type: String,
    default: '',
  },
  title: {
    type: String,
    default: '',
  },
  body: {
    type: String,
    default: '',
  },
  primaryLabel: {
    type: String,
    default: '',
  },
  secondaryLabel: {
    type: String,
    default: '',
  },
  secondaryHref: {
    type: String,
    default: '',
  },
  storageKey: {
    type: String,
    default: 'site_intro_gate_seen',
  },
  closeAriaLabel: {
    type: String,
    default: '',
  },
});

const isOpen = ref(false);
const dialogRef = ref(null);
const previousFocusedElement = ref(null);

const dialogTitleId = computed(() => 'intro-gate-title');
const dialogDescriptionId = computed(() => 'intro-gate-description');
const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const eyebrowText = computed(() => (typeof props.eyebrow === 'string' ? props.eyebrow.trim() : ''));
const titleText = computed(() => (typeof props.title === 'string' ? props.title.trim() : ''));
const bodyText = computed(() => (typeof props.body === 'string' ? props.body.trim() : ''));

const primaryLabelText = computed(() => {
  const raw = typeof props.primaryLabel === 'string' ? props.primaryLabel.trim() : '';
  return raw || 'Continue';
});
const secondaryLabelText = computed(() => {
  const raw = typeof props.secondaryLabel === 'string' ? props.secondaryLabel.trim() : '';
  return raw || 'Learn more';
});
const secondaryHref = computed(() => {
  const raw = typeof props.secondaryHref === 'string' ? props.secondaryHref.trim() : '';
  return raw || '#';
});
const closeButtonAriaLabel = computed(() => {
  const raw = typeof props.closeAriaLabel === 'string' ? props.closeAriaLabel.trim() : '';
  return raw || 'Close dialog';
});

function getStorageKey() {
  return props.storageKey || 'intro_gate_seen';
}

function getSessionKey() {
  return `${getStorageKey()}_session`;
}

function hasSeenGate() {
  if (import.meta.env.SSR) return true;
  try {
    const storageKey = getStorageKey();
    const sessionKey = getSessionKey();
    return localStorage.getItem(storageKey) === '1' || sessionStorage.getItem(sessionKey) === '1';
  } catch {
    return false;
  }
}

function rememberGate() {
  if (import.meta.env.SSR) return;
  try {
    localStorage.setItem(getStorageKey(), '1');
  } catch {}
  try {
    sessionStorage.setItem(getSessionKey(), '1');
  } catch {}
}

function handleDismiss(source) {
  rememberGate();
  isOpen.value = false;
  trackEvent('intro_gate_dismissed', { source });
}

function handlePrimaryClick() {
  handleDismiss('continue');
}

function focusDialog() {
  if (typeof window === 'undefined') return;
  nextTick(() => {
    dialogRef.value?.focus();
  });
}

function restoreFocus() {
  if (!previousFocusedElement.value) return;
  if (typeof previousFocusedElement.value.focus === 'function') {
    previousFocusedElement.value.focus();
  }
  previousFocusedElement.value = null;
}

function trapFocus(event) {
  if (!isOpen.value) return;
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
}

function handleKeydown(event) {
  if (!isOpen.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    handleDismiss('escape');
  } else if (event.key === 'Tab') {
    trapFocus(event);
  }
}

watch(
  () => isOpen.value,
  (open) => {
    if (import.meta.env.SSR) return;
    if (open) {
      previousFocusedElement.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusDialog();
      document.addEventListener('keydown', handleKeydown);
    } else {
      document.removeEventListener('keydown', handleKeydown);
      restoreFocus();
    }
  }
);

function maybeOpenGate() {
  if (import.meta.env.SSR) return;
  if (!props.enabled) return;
  if (hasSeenGate()) return;
  isOpen.value = true;
}

watch(
  () => props.enabled,
  (enabled) => {
    if (!enabled) {
      isOpen.value = false;
      return;
    }
    maybeOpenGate();
  },
  { immediate: true }
);

onMounted(() => {
  if (import.meta.env.SSR) return;
  maybeOpenGate();
});

onBeforeUnmount(() => {
  if (import.meta.env.SSR) return;
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.intro-gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.intro-gate-backdrop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: clamp(24px, 6vw, 48px);
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 45, 134, 0.18), transparent 55%),
    radial-gradient(circle at 80% 15%, rgba(39, 243, 255, 0.14), transparent 60%),
    rgba(8, 6, 12, 0.88);
  backdrop-filter: blur(12px);
}

.intro-gate-dialog {
  position: relative;
  max-width: 34rem;
  width: 100%;
  padding: clamp(32px, 5.2vw, 48px);
  border-radius: clamp(18px, 3vw, 26px);
  background: linear-gradient(155deg, rgba(12, 10, 18, 0.95), rgba(18, 12, 26, 0.92) 60%, rgba(26, 14, 44, 0.9));
  color: #f9fafb;
  box-shadow:
    0 34px 72px rgba(5, 3, 10, 0.7),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  outline: none;
  overflow: hidden;
}

.intro-gate-glow {
  position: absolute;
  inset: -2px;
  background: linear-gradient(135deg, rgba(255, 45, 134, 0.45), rgba(39, 243, 255, 0.4));
  filter: blur(32px);
  opacity: 0.3;
  pointer-events: none;
  z-index: 0;
}

.intro-gate-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  border: none;
  background: transparent;
  color: rgba(248, 250, 252, 0.7);
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
  transition: color 0.2s ease, transform 0.2s ease;
}

.intro-gate-close:hover,
.intro-gate-close:focus {
  color: #ffffff;
  transform: scale(1.05);
}

.intro-gate-close:focus-visible {
  outline: 2px solid #f9fafb;
  outline-offset: 2px;
}

.intro-gate-eyebrow {
  margin: 0 0 clamp(0.4rem, 1.4vw, 0.75rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 0.7rem;
  color: rgba(248, 250, 252, 0.72);
  background: rgba(255, 255, 255, 0.08);
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.intro-gate-title {
  margin: clamp(0.35rem, 1.5vw, 0.65rem) 0 clamp(1rem, 2.2vw, 1.4rem);
  font-size: clamp(1.9rem, 3vw, 2.35rem);
  line-height: 1.18;
  font-weight: 700;
}

.intro-gate-body {
  margin: 0 0 clamp(1.5rem, 4vw, 2.2rem);
  font-size: 1.05rem;
  line-height: 1.65;
  color: rgba(248, 250, 252, 0.8);
}

.intro-gate-actions {
  display: grid;
  gap: 0.85rem;
}

.intro-gate-primary,
.intro-gate-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--brand-button-radius, 14px);
  padding: 0.85rem 1.75rem;
  font-weight: 600;
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  text-align: center;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.intro-gate-primary {
  border: none;
  background: var(
    --brand-primary-cta-gradient,
    linear-gradient(135deg, #ff2d86 0%, #9a2eff 55%, #27f3ff 100%)
  );
  color: var(--brand-primary-cta-text, #0a0a0d);
  cursor: pointer;
  box-shadow: var(--brand-primary-cta-shadow, 0 18px 40px rgba(255, 45, 134, 0.45));
  position: relative;
  overflow: hidden;
}

.intro-gate-primary:hover,
.intro-gate-primary:focus {
  transform: translateY(-2px);
  box-shadow: var(--brand-primary-cta-hover-shadow, 0 20px 44px rgba(255, 45, 134, 0.55));
}

.intro-gate-primary::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0));
  transform: translateX(-120%);
  transition: transform 0.35s ease;
}

.intro-gate-primary:hover::after,
.intro-gate-primary:focus::after {
  transform: translateX(0%);
}

.intro-gate-primary:focus-visible {
  outline: 2px solid rgba(39, 243, 255, 0.6);
  outline-offset: 3px;
}

.intro-gate-secondary {
  border: 1px solid rgba(39, 243, 255, 0.35);
  color: var(--brand-electric-blue, #27f3ff);
  text-decoration: none;
  background: transparent;
}

.intro-gate-secondary:hover,
.intro-gate-secondary:focus {
  color: var(--brand-neon-pink, #ff2d86);
  border-color: rgba(255, 45, 134, 0.55);
  transform: translateY(-1px);
}

.intro-gate-secondary:focus-visible {
  outline: 2px solid rgba(39, 243, 255, 0.6);
  outline-offset: 3px;
}

@media (min-width: 480px) {
  .intro-gate-actions {
    flex-direction: row;
  }

  .intro-gate-secondary {
    padding-inline: 1.2rem;
  }
}
</style>
