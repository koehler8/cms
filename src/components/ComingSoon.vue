<template>
  <section
    v-if="shouldRender"
    id="coming-soon"
    class="coming-soon-section section-shell"
    data-analytics-section="coming-soon"
  >
    <div class="container">
      <div class="coming-soon-shell brand-card">
        <div class="coming-soon-preamble">
          <span
            v-if="eyebrow"
            class="coming-soon-eyebrow ui-label-sm text-uppercase"
          >
            {{ eyebrow }}
          </span>
          <span
            v-if="badge.text"
            class="coming-soon-badge"
          >
            {{ badge.text }}
          </span>
        </div>
        <h2 class="coming-soon-title ui-title-md">
          {{ title }}
        </h2>
        <p class="coming-soon-message">
          {{ message }}
        </p>
        <ul
          v-if="highlights.length"
          class="coming-soon-highlights"
        >
          <li
            v-for="(highlight, index) in highlights"
            :key="`coming-soon-highlight-${index}`"
            class="coming-soon-highlight brand-card"
          >
            <span
              v-if="highlight.icon"
              class="coming-soon-highlight-icon"
              aria-hidden="true"
            >
              {{ highlight.icon }}
            </span>
            <span class="coming-soon-highlight-text">
              {{ highlight.text }}
            </span>
          </li>
        </ul>
        <p
          v-if="note"
          class="coming-soon-note"
        >
          {{ note }}
        </p>
        <div
          v-if="actions.length"
          class="coming-soon-actions"
        >
          <a
            v-for="action in actions"
            :key="action.key"
            class="coming-soon-action"
            :class="[
              action.variant === 'secondary'
                ? 'coming-soon-action--secondary'
                : 'coming-soon-action--primary',
            ]"
            :href="action.href"
            :target="action.target"
            :rel="action.rel"
            @click="(event) => handleActionClick(event, action)"
          >
            <span>{{ action.text }}</span>
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, ref } from 'vue';

import { useComingSoonResolver } from '../composables/useComingSoonConfig.js';
import { useComingSoonInterstitial } from '../composables/useComingSoonInterstitial.js';
import { trackEvent } from '../utils/analytics.js';

const pageContent = inject('pageContent', ref({}));
const siteData = inject('siteData', ref({}));

const comingSoonSource = computed(() => {
  const pageBlock = pageContent.value?.comingSoon;
  if (pageBlock && typeof pageBlock === 'object') {
    return pageBlock;
  }
  const sharedBlock = siteData.value?.shared?.content?.comingSoon;
  if (sharedBlock && typeof sharedBlock === 'object') {
    return sharedBlock;
  }
  return null;
});

const fallbackTitle = 'Coming Soon';
const fallbackMessage = "We're putting the finishing touches on this experience. Check back soon!";

const stringOrFallback = (value, fallback = '') => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
};

const title = computed(() =>
  stringOrFallback(comingSoonSource.value?.title, fallbackTitle)
);
const message = computed(() =>
  stringOrFallback(comingSoonSource.value?.message, fallbackMessage)
);
const eyebrow = computed(() => stringOrFallback(comingSoonSource.value?.eyebrow));
const note = computed(() => stringOrFallback(comingSoonSource.value?.note));

const badge = computed(() => {
  const rawBadge = comingSoonSource.value?.badge;
  if (typeof rawBadge === 'string') {
    return { text: rawBadge.trim(), variant: null };
  }
  if (!rawBadge || typeof rawBadge !== 'object') {
    return { text: '', variant: null };
  }
  return {
    text: stringOrFallback(rawBadge.text),
    variant: stringOrFallback(rawBadge.variant),
  };
});

function normalizeHighlights(source) {
  if (!source) return [];

  const candidates = Array.isArray(source) ? source : [];
  return candidates
    .map((entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        return trimmed ? { text: trimmed, icon: '' } : null;
      }
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const text = stringOrFallback(entry.text);
      const icon = stringOrFallback(entry.icon);
      if (!text) return null;
      return { text, icon };
    })
    .filter(Boolean);
}

const highlights = computed(() => {
  const sourceHighlights =
    comingSoonSource.value?.highlights ??
    comingSoonSource.value?.bullets ??
    comingSoonSource.value?.items;
  return normalizeHighlights(sourceHighlights);
});

function normalizeAction(raw, fallbackVariant = 'primary', index = 0) {
  if (!raw) return null;

  let base = raw;
  if (typeof raw === 'string') {
    base = { text: raw, href: raw.startsWith('#') ? raw : 'coming-soon' };
  }
  if (typeof base !== 'object') {
    return null;
  }

  const text = stringOrFallback(base.text);
  const href = stringOrFallback(base.href, 'coming-soon');
  if (!text || !href) {
    return null;
  }

  const variant = stringOrFallback(base.variant, fallbackVariant).toLowerCase() === 'secondary'
    ? 'secondary'
    : 'primary';

  const openInNewTab =
    typeof base.openInNewTab === 'boolean'
      ? base.openInNewTab
      : base.target === '_blank';

  const rel = openInNewTab ? base.rel || 'noopener noreferrer' : base.rel || null;
  const target = openInNewTab ? '_blank' : base.target || null;

  return {
    key: `${text}-${href}-${variant}-${index}`,
    text,
    href,
    variant,
    target,
    rel,
    trigger: stringOrFallback(
      base.analyticsTrigger || base.trigger,
      variant === 'secondary' ? 'coming-soon-secondary' : 'coming-soon-primary'
    ),
  };
}

function dedupeActions(items) {
  const map = new Map();
  for (const action of items) {
    if (!action) continue;
    const key = `${action.text}|${action.href}|${action.variant}`;
    if (!map.has(key)) {
      map.set(key, action);
    }
  }
  return Array.from(map.values());
}

const actions = computed(() => {
  if (!comingSoonSource.value) {
    return [];
  }

  const rawActions = [];
  const source = comingSoonSource.value;

  if (Array.isArray(source.actions)) {
    rawActions.push(
      ...source.actions.map((action, index) =>
        normalizeAction(action, index === 0 ? 'primary' : 'secondary', index)
      )
    );
  }

  if (source.cta) {
    rawActions.push(normalizeAction(source.cta, 'primary', rawActions.length));
  }

  if (source.primaryAction) {
    rawActions.push(normalizeAction(source.primaryAction, 'primary', rawActions.length));
  }

  if (source.secondaryAction) {
    rawActions.push(normalizeAction(source.secondaryAction, 'secondary', rawActions.length));
  }

  return dedupeActions(rawActions).filter(Boolean);
});

const shouldRender = computed(() => !!comingSoonSource.value);

const { openComingSoon } = useComingSoonInterstitial();
const { resolve: resolveComingSoon } = useComingSoonResolver(pageContent);

function handleActionClick(event, action) {
  if (!event || !action) return;

  const modalPayload = resolveComingSoon({ href: action.href });
  if (!modalPayload) {
    return;
  }

  event.preventDefault();
  openComingSoon(modalPayload);

  trackEvent('coming_soon_interstitial_shown', {
    trigger: action.trigger || 'coming-soon-cta',
    label: action.text ? action.text.toLowerCase() : 'coming-soon',
  });
}
</script>

<style scoped>
.coming-soon-section {
  position: relative;
  padding-block: clamp(80px, 12vw, 160px);
}

.coming-soon-shell {
  --coming-soon-text: var(--brand-card-text, var(--ui-text-primary, #ffffff));
  --coming-soon-text-muted: color-mix(in srgb, var(--coming-soon-text) 70%, transparent);
  --coming-soon-text-subtle: color-mix(in srgb, var(--coming-soon-text) 55%, transparent);
  padding: clamp(2rem, 4vw, 3.5rem);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  border-radius: var(--brand-surface-card-radius, 28px);
  background: var(--brand-surface-card, rgba(9, 6, 20, 0.92));
  color: var(--coming-soon-text);
}

.coming-soon-preamble {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.coming-soon-eyebrow {
  letter-spacing: 0.12em;
  color: var(--coming-soon-text-muted, var(--ui-text-muted, rgba(255, 255, 255, 0.72)));
}

.coming-soon-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--coming-soon-text);
}

.coming-soon-title {
  margin: 0;
  color: var(--coming-soon-text);
}

.coming-soon-message {
  margin: 0;
  font-size: 1.125rem;
  line-height: 1.7;
  color: var(--coming-soon-text-muted, var(--ui-text-muted, rgba(255, 255, 255, 0.86)));
}

.coming-soon-highlights {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.coming-soon-highlight {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: clamp(16px, 2vw, 20px);
  background: var(--surface-tabs-bg, rgba(255, 255, 255, 0.04));
}

.coming-soon-highlight-icon {
  font-size: 1.5rem;
}

.coming-soon-highlight-text {
  color: var(--coming-soon-text);
  line-height: 1.4;
}

.coming-soon-note {
  margin: 0;
  font-size: 0.95rem;
  color: var(--coming-soon-text-subtle, var(--ui-text-muted, rgba(255, 255, 255, 0.72)));
}

.coming-soon-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.coming-soon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.9rem 1.75rem;
  border-radius: var(--brand-button-radius, 999px);
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.coming-soon-action--primary {
  background: var(
    --brand-cta-gradient,
    linear-gradient(90deg, #ff42a5 0%, #7f5dff 50%, #48d5ff 100%)
  );
  color: #0b0418;
}

.coming-soon-action--secondary {
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: var(--coming-soon-text);
}

.coming-soon-action:hover,
.coming-soon-action:focus {
  transform: translateY(-2px);
  opacity: 0.92;
}

@media (max-width: 767px) {
  .coming-soon-shell {
    padding: 1.75rem;
  }

  .coming-soon-highlights {
    grid-template-columns: 1fr;
  }

  .coming-soon-action {
    width: 100%;
  }
}
</style>
