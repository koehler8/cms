<template>
  <section
    id="team"
    class="team-section ui-section ui-section--stacked"
    data-analytics-section="team"
    ref="teamSection"
  >
    <div class="container">
      <header v-if="teamTitle || teamDescription" class="section-header text-center">
        <div v-if="teamTitle" class="section-heading">
          <h2 class="display-heading team-heading">{{ formattedTeamTitle }}</h2>
          <span class="section-divider" aria-hidden="true"></span>
        </div>
        <p v-if="teamDescription" class="section-description">{{ teamDescription }}</p>
      </header>

      <div class="team-grid ui-card-grid ui-card-grid--team">
        <div
          v-for="(member, idx) in members"
          :key="idx"
          class="team-card ui-card-grid__item"
        >
          <figure
            class="team-card__inner text-center ui-card ui-card-surface fade-up-in js-scroll-fade"
            :style="{ '--fade-up-delay': `${Math.min(idx, 4) * 0.06}s` }"
          >
            <div class="profile-frame ui-visual-shell ui-visual-shell--circle">
              <img
                class="profile-photo"
                :src="member.image"
                :alt="member.name"
                loading="lazy"
                decoding="async"
              >
            </div>
            <div class="team-card__meta">
              <h4 class="team-card__name">{{ member.name }}</h4>
              <em class="team-card__role">{{ member.role }}</em>
            </div>
            <p class="team-card__bio">{{ member.bio }}</p>
        <ul v-if="member.socials.length" class="team-card__socials">
          <li
            v-for="(social, socialIdx) in member.socials"
            :key="socialIdx"
            class="team-card__social"
          >
            <a
              :href="social.href"
              class="team-card__social-link"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="buildSocialAriaLabel(member.name, social)"
            >
              <component
                v-if="social.iconComponent"
                :is="social.iconComponent"
                class="team-card__icon-svg"
              />
              <span v-else-if="social.iconGlyph" class="team-card__icon-glyph" aria-hidden="true">
                {{ social.iconGlyph }}
              </span>
              <img
                v-else-if="social.icon"
                class="team-card__icon-img"
                    :src="resolveImage(social.icon)"
                    :alt="social.label || social.icon"
                    loading="lazy"
                    decoding="async"
                  >
                  <span v-else class="team-card__icon-fallback" aria-hidden="true">↗</span>
                </a>
              </li>
            </ul>
          </figure>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import IconX from './icons/IconX.vue';
import IconLinkedIn from './icons/IconLinkedIn.vue';
import { resolveMedia } from '../utils/assetResolver.js';
import { registerScrollReveal } from '../utils/useScrollReveal.js';

const teamSection = ref(null);
const teamTitle = ref('');
const teamDescription = ref('');
const members = ref([]);

const resolveImage = (src) => resolveMedia(src);

const SOCIAL_GLYPH_MAP = {
  twitter: '𝕏',
  x: '𝕏',
  linkedin: 'in',
  facebook: 'f',
  instagram: 'IG',
  discord: '☍',
  telegram: '✈',
  github: '{ }',
  medium: 'M',
};

const SOCIAL_ICON_COMPONENTS = {
  twitter: markRaw(IconX),
  x: markRaw(IconX),
  linkedin: markRaw(IconLinkedIn),
};

const shouldTreatAsAsset = (value = '') => {
  if (!value) return false;
  return /[./]/.test(value) || value.startsWith('data:') || value.startsWith('http');
};

const normalizeSocials = (socials) => {
  if (!Array.isArray(socials)) return [];
  return socials
    .filter((item) => item && typeof item.href === 'string' && item.href.trim())
    .map((item) => ({
      icon: shouldTreatAsAsset(item.icon) ? item.icon.trim() : '',
      iconGlyph:
        item.iconGlyph ||
        (!shouldTreatAsAsset(item.icon) && typeof item.icon === 'string'
          ? SOCIAL_GLYPH_MAP[item.icon.trim().toLowerCase()] || item.icon.trim().slice(0, 2).toUpperCase()
          : ''),
      iconComponent:
        typeof item.icon === 'string' ? SOCIAL_ICON_COMPONENTS[item.icon.trim().toLowerCase()] || null : null,
      href: item.href.trim(),
      label: typeof item.label === 'string' ? item.label.trim() : '',
      ariaLabel: typeof item.ariaLabel === 'string' ? item.ariaLabel.trim() : '',
    }));
};

const pageContent = inject('pageContent', ref({}));

const formattedTeamTitle = computed(() => teamTitle.value || '');

const setupScrollReveal = () => {
  nextTick(() => {
    if (!teamSection.value) return;
    const targets = teamSection.value.querySelectorAll('.js-scroll-fade');
    registerScrollReveal(targets);
  });
};

watch(
  () => pageContent.value,
  (content) => {
    const teamConfig = content?.team || {};

    teamTitle.value = teamConfig.title || '';
    teamDescription.value = teamConfig.description || '';

    members.value = Array.isArray(teamConfig.members)
      ? teamConfig.members.map((member) => ({
          name: member?.name || '',
          role: member?.role || '',
          bio: member?.bio || '',
          image: resolveImage(member?.image),
          socials: normalizeSocials(member?.socials),
        }))
      : [];
    setupScrollReveal();
    nextTick(() => {
      registerResizeHandlers();
      scheduleEqualizeTeamCards();
    });
  },
  { immediate: true }
);

let resizeObserver;
let windowResizeAttached = false;
let equalizeRaf = 0;

function equalizeTeamCards() {
  const section = teamSection.value;
  if (!section) return;

  section.style.removeProperty('--team-card-equal-height');
  const cards = section.querySelectorAll('.team-card__inner');
  if (!cards.length) return;

  let tallest = 0;
  cards.forEach((card) => {
    const { height } = card.getBoundingClientRect();
    if (height > tallest) {
      tallest = height;
    }
  });

  if (tallest > 0) {
    section.style.setProperty('--team-card-equal-height', `${Math.ceil(tallest)}px`);
  }
}

function scheduleEqualizeTeamCards() {
  if (typeof window === 'undefined') return;
  if (equalizeRaf) {
    cancelAnimationFrame(equalizeRaf);
  }
  equalizeRaf = window.requestAnimationFrame(() => {
    equalizeRaf = 0;
    equalizeTeamCards();
  });
}

function registerResizeHandlers() {
  if (typeof window === 'undefined') return;
  if (typeof ResizeObserver !== 'undefined') {
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        scheduleEqualizeTeamCards();
      });
    } else {
      resizeObserver.disconnect();
    }
    if (teamSection.value) {
      resizeObserver.observe(teamSection.value);
    }
    return;
  }

  if (!windowResizeAttached) {
    window.addEventListener('resize', scheduleEqualizeTeamCards);
    windowResizeAttached = true;
  }
}

function cleanupResizeHandlers() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
    return;
  }
  if (windowResizeAttached) {
    window.removeEventListener('resize', scheduleEqualizeTeamCards);
    windowResizeAttached = false;
  }
}

onMounted(() => {
  setupScrollReveal();
  nextTick(() => {
    registerResizeHandlers();
    scheduleEqualizeTeamCards();
  });
});

onBeforeUnmount(() => {
  cleanupResizeHandlers();
  if (equalizeRaf) {
    cancelAnimationFrame(equalizeRaf);
    equalizeRaf = 0;
  }
});

const buildSocialAriaLabel = (memberName, social) => {
  const safeName = typeof memberName === 'string' && memberName.trim() ? memberName.trim() : 'Team member';
  if (social.ariaLabel) {
    return social.ariaLabel;
  }

  const platform = social.label || (social.icon ? social.icon.toString().replace(/[^a-z0-9]+/gi, ' ').trim() : 'social profile');
  const base = `${safeName} on ${platform}`.trim();
  return `${base} (opens in a new tab)`;
};
</script>

<style scoped>
.team-section {
  background: var(
    --team-section-bg,
    var(--ui-section-bg, var(--theme-body-background, var(--brand-bg-900, #f5f7ff)))
  );
  --section-divider-color: var(--brand-border-highlight, rgba(79, 108, 240, 0.28));
  --section-description-color: var(--ui-text-muted, rgba(31, 42, 68, 0.72));
  --team-card-padding-x: clamp(16px, 3vw, 26px);
  --team-card-padding-y: clamp(12px, 2.5vw, 22px);
  --team-card-gap: var(--ui-card-gap, 24px);
  --team-social-gap: clamp(18px, 3vw, 28px);
  --team-card-max-width: clamp(300px, 28vw, 360px);
  --team-card-stack-gap: clamp(4px, 1vw, 12px);
}

.team-card {
  height: 100%;
  display: flex;
}

.team-card__inner {
  flex: 1;
  height: 100%;
  width: min(100%, var(--team-card-max-width, clamp(300px, 28vw, 360px)));
  margin: 0 auto;
  min-height: var(--team-card-equal-height, auto);
  padding:
    var(--team-card-padding-y, clamp(12px, 2.5vw, 22px))
    var(--team-card-padding-x, clamp(16px, 3vw, 26px));
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--team-card-stack-gap, clamp(4px, 1vw, 12px));
}

.profile-frame {
  width: min(220px, 72%);
  aspect-ratio: 1 / 1;
  margin-bottom: 0;
}

.profile-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  box-shadow: var(--brand-card-shadow, 0 12px 24px rgba(15, 23, 42, 0.18));
}

.team-card__meta {
  margin-bottom: 0;
}

.team-card__name {
  margin: 0 0 2px;
  font-size: 1.18rem;
  color: var(--ui-text-primary, var(--brand-fg-100));
}

.team-card__role {
  font-style: normal;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  /* AA-safe muted text on the white card. Don't fall through to a brand
     color rgba — it composites below 4.5:1. */
  color: var(--team-role-color, var(--ui-text-muted, #54627b));
}

.team-card__bio {
  color: var(--ui-text-muted, rgba(31, 42, 68, 0.72));
  font-size: 0.92rem;
  margin-bottom: 4px;
}

.team-card__socials {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--team-social-gap, clamp(18px, 3vw, 28px));
  list-style: none;
  margin: 0;
  padding: 0;
  margin-top: auto;
  padding-bottom: 4px;
}

.team-card__social {
  margin: 0;
}

.team-card__social-link {
  min-width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  color: var(
    --team-social-icon-color,
    color-mix(in srgb, var(--helper-strip-color, rgba(190, 197, 212, 0.95)) 92%, white 8%)
  );
  background: var(
    --team-social-icon-bg,
    color-mix(in srgb, var(--helper-strip-bg, rgba(196, 200, 214, 0.24)) 65%, white 35%)
  );
  border: 1px solid
    var(
      --team-social-icon-border,
      color-mix(in srgb, var(--helper-strip-border, rgba(200, 204, 216, 0.32)) 80%, white 20%)
    );
  box-shadow: var(--team-social-icon-shadow, 0 8px 20px rgba(10, 8, 20, 0.18));
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.team-card__social-link:hover,
.team-card__social-link:focus-visible {
  color: var(
    --helper-strip-hover-color,
    var(--helper-strip-color, var(--brand-icon-badge-color, rgba(210, 215, 226, 1)))
  );
  background: var(
    --helper-strip-hover-bg,
    var(--helper-strip-bg, rgba(180, 186, 198, 0.25))
  );
  border-color: var(
    --helper-strip-hover-border,
    var(--helper-strip-border, var(--brand-border-glow, rgba(210, 215, 226, 0.45)))
  );
  transform: translateY(-1px);
  outline: 2px solid
    var(
      --helper-strip-hover-color,
      var(--helper-strip-color, var(--brand-border-glow, rgba(210, 215, 226, 0.45)))
    );
  outline-offset: 2px;
}

.team-card__icon-img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.team-card__icon-svg :deep(svg) {
  width: 20px;
  height: 20px;
  color: currentColor;
}

.team-card__icon-glyph,
.team-card__icon-fallback {
  font-size: 1rem;
  line-height: 1;
  color: currentColor;
}
</style>
