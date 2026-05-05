<template>
  <header
    id="js-header"
    class="site-header ui-header"
    :class="{ 'site-header--compact': isHeaderCompact }"
  >
    <div
      class="site-header__section ui-header__section"
      :class="{ 'ui-header__section--compact': isHeaderCompact }"
    >
      <nav class="site-header__nav" aria-label="Primary">
        <div class="container">
          <div class="site-header__inner">
            <a href="/" ref="logoLinkRef" class="site-header__logo logo-flash-trigger" :aria-label="`${siteName || 'Home'} – home`">
              <!--
                Logo slot. Default rendering: <img> if site/assets/img/logo.png
                exists or `content.header.logoSrc` is set, otherwise text from
                `content.header.logoText` or the site title. Sites that wrap
                Header in a parent component can override entirely via
                <template #logo>.
              -->
              <slot name="logo" :src="logoSrc" :text="logoText" :site-name="siteName">
                <img
                  v-if="logoSrc"
                  :src="logoSrc"
                  :alt="siteName"
                  class="logo-flash-image"
                />
                <span v-else class="site-header__logo-text">{{ logoText || siteName }}</span>
              </slot>
          </a>
          <!--
            Nav slot. Defaults to a horizontal <ul> of links built from
            `content.header.navItems[]` (each entry: { text, href, target? }).
            No items, no nav.
          -->
          <slot name="nav" :items="navItems">
            <ul v-if="navItems.length" class="site-header__nav-list">
              <li v-for="(item, idx) in navItems" :key="`${item.href || item.text}-${idx}`">
                <a
                  :href="item.href"
                  :target="item.target || null"
                  :rel="item.target === '_blank' ? 'noopener noreferrer' : null"
                >{{ item.text }}</a>
              </li>
            </ul>
          </slot>
          <div v-if="hasHeaderActions || showLocaleLinks || hasActionsSlot" class="site-header__actions">
            <!-- Site-provided extra actions, rendered before the locale dropdown. -->
            <slot name="actions" />
            <component
              v-if="headerActionsComponent"
              :is="headerActionsComponent"
            />
            <div
              v-if="showLocaleLinks && availableLocales.length > 1"
              ref="localeWrapperRef"
              class="locale-wrapper"
              @keydown.esc="closeLocaleMenu($event, 'escape')"
              @focusout="onLocaleWrapperFocusOut"
            >
              <button
                id="languages-dropdown-invoker-2"
                ref="langButtonRef"
                class="locale-toggle"
                type="button"
                aria-controls="languages-dropdown-2"
                :aria-expanded="isLangOpen ? 'true' : 'false'"
                aria-label="Change language"
                @click="toggleLocaleMenu"
              >
                <span class="locale-flag" aria-hidden="true">
                  {{ localeEmojis[(currentLocale || 'en').toLowerCase()] || '🌐' }}
                </span>
                <span class="locale-label">
                  {{ (currentLocale || 'en').toUpperCase() }}
                </span>
                <svg class="locale-toggle__icon" viewBox="0 0 16 16" aria-hidden="true" width="16" height="16">
                  <path
                    d="M4 6l4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <ul
                id="languages-dropdown-2"
                ref="langMenuRef"
                class="locale-menu ui-locale-menu"
                :class="{ 'locale-menu--hidden': !isLangOpen }"
                aria-labelledby="languages-dropdown-invoker-2"
                :style="localeMenuStyle"
              >
                <li v-for="locale in availableLocales" :key="locale">
                  <a
                    class="locale-option"
                    :href="localeHref(locale)"
                    @click="handleLocaleLinkClick(locale)"
                  >
                    <span class="locale-flag" aria-hidden="true">{{ localeEmojis[locale] || '🌐' }}</span>
                    <span class="locale-label">{{ localeLabels[locale] || locale.toUpperCase() }}</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
    </div>
      </nav>
    </div>
  </header>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue';
  import { useRoute } from 'vue-router';
  import { resolveAsset } from '../utils/assetResolver.js';
import { trackEvent } from '../utils/analytics.js';
import { getExtensionComponent } from '../extensions/extensionLoader.js';
import { availableLocales as siteLocales, baseLocale as siteBaseLocale } from '../utils/loadConfig.js';

  const slots = useSlots();
  const hasActionsSlot = computed(() => Boolean(slots.actions));

const isLangOpen = ref(false);
const isHeaderCompact = ref(false);
const currentLocale = ref('');
const availableLocales = computed(() => siteLocales.map((code) => code.trim()).filter(Boolean));

// The base locale is served at the unprefixed root path (`/`) — clicking
// the dropdown item for it should NOT navigate to `/{baseLocale}` because
// that URL doesn't pre-render and would 404. Build the link path
// accordingly: base → `/`, others → `/{locale}`.
const localeHref = (locale) => {
  return locale === siteBaseLocale ? '/' : `/${locale}`;
};
const localeLabels = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  zh: '简体中文',
  th: 'ไทย',
  hi: 'हिन्दी',
  fil: 'Filipino',
};

const localeEmojis = {
  en: '🇺🇸',
  fr: '🇫🇷',
  es: '🇪🇸',
  de: '🇩🇪',
  ja: '🇯🇵',
  ko: '🇰🇷',
  pt: '🇵🇹',
  ru: '🇷🇺',
  tr: '🇹🇷',
  vi: '🇻🇳',
  id: '🇮🇩',
  zh: '🇨🇳',
  th: '🇹🇭',
  hi: '🇮🇳',
  fil: '🇵🇭',
};
  const langButtonRef = ref(null);
  const langMenuRef = ref(null);
  const localeWrapperRef = ref(null);
  const localeMenuStyle = ref({ animationDuration: '500ms' });
  const logoLinkRef = ref(null);
  const route = useRoute();
  const showLocaleLinks = ref(true);

  // Extension slot: render HeaderActions component if an extension registered one
  const headerActionsComponent = computed(() => getExtensionComponent('HeaderActions'));
  const hasHeaderActions = computed(() => Boolean(headerActionsComponent.value));

  let removeLogoListeners = () => {};
  let logoFlashTimeoutId = null;

const handleHeaderScroll = () => {
  if (typeof window === 'undefined') return;
  isHeaderCompact.value = window.scrollY > 30;
};

const updateLocaleMenuPosition = () => {
    if (typeof window === 'undefined') return;
    const menuEl = langMenuRef.value;
    const wrapperEl = localeWrapperRef.value;
    const headerEl = document.getElementById('js-header');
    if (!menuEl || !wrapperEl || !headerEl) return;

    const wrapperRect = wrapperEl.getBoundingClientRect();
    const headerRect = headerEl.getBoundingClientRect();
    const topOffset = Math.max(headerRect.bottom - wrapperRect.top, 0);

    localeMenuStyle.value = {
      animationDuration: '500ms',
      top: `${topOffset}px`,
    };
  };

  const handleViewportChange = () => {
    if (isLangOpen.value) {
      updateLocaleMenuPosition();
    }
  };

  const onDocumentClick = (e) => {
    const btn = langButtonRef.value;
    const menu = langMenuRef.value;
    if (btn && btn.contains(e.target)) return; // toggle handled by button
    if (menu && !menu.contains(e.target)) {
      if (isLangOpen.value) {
        isLangOpen.value = false;
        trackEvent('header_locale_menu_toggle', {
          state: 'close',
          trigger: 'outside_click',
          active_locale: currentLocale.value || 'en',
        });
      }
    }
  };

  // Closes the dropdown and (for keyboard dismissal) returns focus to the
  // toggle button. Without focus restoration, ESC would leave focus on a
  // hidden menu item — failing 1.4.13 (Content on Hover or Focus).
  const closeLocaleMenu = (event, trigger = 'escape') => {
    if (!isLangOpen.value) return;
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    isLangOpen.value = false;
    trackEvent('header_locale_menu_toggle', {
      state: 'close',
      trigger,
      active_locale: currentLocale.value || 'en',
    });
    if (trigger === 'escape') {
      nextTick(() => langButtonRef.value?.focus());
    }
  };

  // Closes the menu when keyboard focus leaves the wrapper entirely.
  // Without this, Tab would walk past the dropdown but leave it visible
  // and clickable — also fails 1.4.13's "dismissable" requirement.
  const onLocaleWrapperFocusOut = (event) => {
    if (!isLangOpen.value) return;
    const wrapper = localeWrapperRef.value;
    const next = event.relatedTarget;
    if (wrapper && next && wrapper.contains(next)) return;
    closeLocaleMenu(null, 'focusout');
  };

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const triggerLogoFlash = () => {
    if (prefersReducedMotion()) return;
    const el = logoLinkRef.value;
    if (!el || el.classList.contains('logo-flash-active')) return;

    el.classList.add('logo-flash-active');
    if (logoFlashTimeoutId) {
      window.clearTimeout(logoFlashTimeoutId);
    }
    logoFlashTimeoutId = window.setTimeout(() => {
      el.classList.remove('logo-flash-active');
      logoFlashTimeoutId = null;
    }, 460);
  };

  const setupLogoFlash = () => {
    if (prefersReducedMotion()) return;
    const el = logoLinkRef.value;
    if (!el) return;

    const handlePointerEnter = () => triggerLogoFlash();
    const handleFocus = () => triggerLogoFlash();

    el.addEventListener('pointerenter', handlePointerEnter);
    el.addEventListener('focus', handleFocus);

    removeLogoListeners = () => {
      el.removeEventListener('pointerenter', handlePointerEnter);
      el.removeEventListener('focus', handleFocus);
    };

    requestAnimationFrame(() => {
      window.setTimeout(() => triggerLogoFlash(), 260);
    });
  };

  const injectedSiteData = inject('siteData', ref({}));
  const pageContent = inject('pageContent', ref({}));

  const siteName = computed(() => injectedSiteData.value?.site?.title || '');

  // Header content (merged from shared.json + per-page overrides). Three
  // optional knobs sites can use to customise the bundled Header without
  // wrapping it in a parent component:
  //   - content.header.logoText  → text shown in place of the site title
  //   - content.header.logoSrc   → full URL to use as the logo image
  //                                 (overrides the site/assets/img/logo.png
  //                                 asset resolution)
  //   - content.header.navItems  → array of { text, href, target? } to
  //                                 render as a top-level nav menu
  const headerContent = computed(() => {
    const fromPage = pageContent.value?.header;
    if (fromPage && typeof fromPage === 'object') return fromPage;
    const fromSite = injectedSiteData.value?.header;
    return (fromSite && typeof fromSite === 'object') ? fromSite : {};
  });
  const logoText = computed(() => {
    const t = headerContent.value?.logoText;
    return typeof t === 'string' && t.trim() ? t.trim() : '';
  });
  const logoSrc = computed(() => {
    const customSrc = headerContent.value?.logoSrc;
    if (typeof customSrc === 'string' && customSrc.trim()) {
      return customSrc.trim();
    }
    // Fall back to the conventional site/assets/img/logo.png. resolveAsset
    // returns '' when the asset doesn't exist; we treat that as "no image"
    // and the template renders the text fallback instead of a broken <img>.
    return resolveAsset('img/logo.png') || '';
  });
  const navItems = computed(() => {
    const items = headerContent.value?.navItems;
    return Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  });

  const resolveHeaderSettings = () => {
    const pageHeader = pageContent.value?.header;
    if (pageHeader && typeof pageHeader === 'object') {
      return pageHeader;
    }
    const globalHeader = injectedSiteData.value?.header;
    if (globalHeader && typeof globalHeader === 'object') {
      return globalHeader;
    }
    return {};
  };

  const applyHeaderSettings = () => {
    const headerSettings = resolveHeaderSettings();
    showLocaleLinks.value = typeof headerSettings.showLocaleLinks === 'boolean'
      ? headerSettings.showLocaleLinks
      : true;
  };

  watch(
    () => [
      pageContent.value?.header,
      injectedSiteData.value?.header,
    ],
    () => {
      applyHeaderSettings();
      handleViewportChange();
    },
    { immediate: true }
  );

  watch(
    () => isLangOpen.value,
    (open) => {
      if (open) {
        nextTick(() => {
          updateLocaleMenuPosition();
        });
      }
    }
  );

  const toggleLocaleMenu = () => {
    if (!isLangOpen.value) {
      updateLocaleMenuPosition();
    }
    const nextState = !isLangOpen.value;
    isLangOpen.value = nextState;
    trackEvent('header_locale_menu_toggle', {
      state: nextState ? 'open' : 'close',
      trigger: 'button',
      active_locale: currentLocale.value || 'en',
    });
    if (nextState) {
      nextTick(() => {
        updateLocaleMenuPosition();
      });
    }
  };

  const handleLocaleLinkClick = (locale) => {
    trackEvent('header_locale_selected', {
      selected_locale: locale,
      previous_locale: currentLocale.value || 'en',
      source: 'dropdown',
    });
    if (isLangOpen.value) {
      trackEvent('header_locale_menu_toggle', {
        state: 'close',
        trigger: 'selection',
        active_locale: currentLocale.value || 'en',
      });
    }
    isLangOpen.value = false;
  };

  onMounted(() => {
    handleHeaderScroll();
    const loc = (route.params.locale || (typeof localStorage !== 'undefined' && localStorage.getItem('locale')) || 'en').toString();
    currentLocale.value = loc;
    document.addEventListener('click', onDocumentClick);
    setupLogoFlash();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleViewportChange, { passive: true });
      window.addEventListener('scroll', handleViewportChange, { passive: true });
      window.addEventListener('scroll', handleHeaderScroll, { passive: true });
    }
    updateLocaleMenuPosition();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('scroll', handleHeaderScroll);
    }
    removeLogoListeners();
    if (logoFlashTimeoutId) {
      window.clearTimeout(logoFlashTimeoutId);
      logoFlashTimeoutId = null;
    }
  });

  watch(
    () => route.params.locale,
    (nextLocale) => {
      const normalized = typeof nextLocale === 'string' && nextLocale.trim() ? nextLocale.trim() : 'en';
      currentLocale.value = normalized;
    }
  );
</script>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--brand-header-bg, #020409) 92%, transparent);
  color: var(--brand-header-text, var(--brand-fg-100, #f0eaf3));
  box-shadow: var(--site-header-shadow, 0 18px 45px rgba(0, 0, 0, 0.35));
  transition: transform 0.3s ease, background 0.3s ease, box-shadow 0.3s ease;
}

.site-header--compact {
  background: color-mix(in srgb, var(--brand-header-bg, #020409) 98%, transparent);
  box-shadow: var(--site-header-shadow-compact, 0 10px 30px rgba(1, 1, 12, 0.6));
}

.site-header__section {
  padding-block: clamp(10px, 2vw, 16px);
}

.site-header--compact .site-header__section {
  padding-block: clamp(6px, 1.5vw, 12px);
  transition: padding 0.2s ease;
}

.site-header__logo img {
  transition: transform 0.2s ease;
}

.site-header--compact .site-header__logo img {
  transform: scale(0.92);
}

.site-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: clamp(8px, 2vw, 24px);
  width: 100%;
}

.site-header__logo {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.site-header__logo img {
  max-height: 44px;
  width: auto;
}

/* Text fallback when no logo asset / logoSrc is provided. Uses theme tokens
   so the active theme drives appearance; consumers can override via scoped
   CSS in a wrapping component or a brand-var override. */
.site-header__logo-text {
  font-family: var(--ui-font-display, var(--ui-font-body, inherit));
  font-weight: 600;
  font-size: clamp(1rem, 2.5vw, 1.25rem);
  letter-spacing: 0.02em;
  color: var(--brand-header-text, var(--brand-fg-100, inherit));
  white-space: nowrap;
}

/* Nav menu rendered from content.header.navItems[]. Sits between the logo
   and the actions cluster. Hidden on narrow viewports — sites that need
   responsive nav should override the slot. */
.site-header__nav-list {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: clamp(0.75rem, 2vw, 1.75rem);
  align-items: center;
}
@media (min-width: 720px) {
  .site-header__nav-list {
    display: flex;
  }
}
.site-header__nav-list a {
  color: var(--brand-header-text, var(--brand-fg-100, inherit));
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: opacity 0.15s ease;
}
.site-header__nav-list a:hover,
.site-header__nav-list a:focus-visible {
  opacity: 0.7;
  text-decoration: underline;
}

.site-header__actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1 1 auto;
  min-width: 0;
  gap: clamp(8px, 2vw, 20px);
}

.locale-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}

.locale-wrapper .locale-toggle {
  line-height: 1;
}

.ui-header .locale-toggle,
.ui-header .locale-toggle:visited {
  display: inline-flex;
  align-items: center;
  color: var(--ui-header-chip-color, var(--brand-header-text, #ffffff));
  gap: 0.35rem;
  text-decoration: none;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--ui-header-chip-border, rgba(255, 255, 255, 0.25));
  background: var(--ui-header-chip-bg, rgba(0, 0, 0, 0.65));
  font-weight: 600;
  letter-spacing: 0.12em;
  opacity: 0.85;
  text-transform: uppercase;
  transition: opacity 0.2s ease;
}

.ui-header .locale-toggle:hover,
.ui-header .locale-toggle:focus-visible {
  opacity: 1;
  text-decoration: none;
  color: var(--ui-header-chip-color, var(--brand-header-text, #ffffff));
  border-color: color-mix(in srgb, var(--ui-header-chip-border, rgba(255, 255, 255, 0.25)) 140%, transparent);
}

.locale-toggle__icon {
  margin-left: 0.25rem;
}

.ui-locale-menu {
  position: absolute;
  right: 0;
  top: 0;
  background: var(--ui-locale-menu-bg, var(--brand-surface-card-bg, #1a1624));
  color: var(--ui-locale-menu-color, #ffffff);
  border: 1px solid color-mix(in srgb, var(--brand-accent-electric, #4f6cf0) 25%, transparent);
  border-radius: 16px;
  padding: 10px 0 15px;
  box-shadow: var(--brand-surface-card-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
  z-index: 2;
  background-clip: padding-box;
}

.locale-menu {
  max-height: min(70vh, 24rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.25rem;
  scrollbar-gutter: stable both-edges;
  top: 0;
  right: 0;
  left: auto;
  z-index: 400;
}

.locale-menu::-webkit-scrollbar {
  width: 6px;
}

.locale-menu::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.24);
  border-radius: 999px;
}

.locale-menu::-webkit-scrollbar-track {
  background: transparent;
}

.locale-menu--hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-6px);
}

.locale-wrapper .ui-locale-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 12px);
  list-style: none;
  margin: 0;
  min-width: 200px;
  max-width: 280px;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.locale-option,
.locale-option:visited {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  padding: 5px 20px;
  color: var(--ui-locale-menu-color, #ffffff);
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.locale-option .locale-label {
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.locale-option:hover,
.locale-option:focus-visible {
  opacity: 1;
  color: var(--ui-locale-menu-hover-color, #ffffff);
  background: var(--ui-locale-menu-hover-bg);
  text-decoration: none;
}

.locale-flag {
  font-size: 1rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.locale-toggle .locale-label,
.locale-toggle .locale-flag {
  display: inline-flex;
  align-items: center;
  line-height: 1;
  gap: 0.5rem;
}

@media (max-width: 767px) {
  .site-header__inner {
    gap: clamp(6px, 3vw, 16px);
  }
}

@media (max-width: 520px) {
  .site-header__inner {
    gap: clamp(4px, 2vw, 12px);
  }

  .site-header__actions {
    gap: clamp(4px, 2vw, 10px);
  }

  .locale-toggle {
    padding: 0.32rem 0.7rem;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }
}

@media (max-width: 576px) {
  .locale-menu {
    min-width: clamp(12rem, 70vw, 16rem);
    max-width: clamp(12rem, 80vw, 18rem);
    right: -4px;
    left: auto;
  }
}
</style>
