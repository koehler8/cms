<template>
  <footer class="brand-footer" data-analytics-section="footer">
    <div class="container" role="presentation">
      <div class="footer-grid">
        <a class="footer-logo" href="/">
          <img :src="logoSrc" :alt="siteName" class="img-fluid" />
        </a>
        <p class="footer-text">{{ footerText }}</p>
        <p v-if="footerDisclaimer" class="footer-disclaimer">
          {{ footerDisclaimer }}
        </p>
        <nav v-if="footerLinks.length" class="footer-links" aria-label="Legal links">
          <a
            v-for="(link, idx) in footerLinks"
            :key="idx"
            class="footer-link"
            :href="link.href"
            :target="link.target"
            :rel="link.rel"
          >
            {{ link.text }}
          </a>
        </nav>
      </div>
    </div>
  </footer>
</template>

<script setup>
import { computed, inject, ref } from 'vue';
import { resolveAsset } from '../utils/assetResolver.js';

const injectedSiteData = inject('siteData', ref({}));
const pageContent = inject('pageContent', ref({}));

const logoSrc = computed(() => resolveAsset('img/logo.png'));
const siteName = computed(() => injectedSiteData.value?.site?.title || '');

const sharedFooter = computed(() => injectedSiteData.value?.shared?.content?.footer || {});
const pageFooter = computed(() => pageContent.value?.footer || {});

const footerContent = computed(() => {
  const pageValue = pageFooter.value;
  if (pageValue && Object.keys(pageValue).length > 0) return pageValue;
  return sharedFooter.value || {};
});

const footerText = computed(() => footerContent.value?.text || '');
const footerLinks = computed(() => {
  const links = Array.isArray(footerContent.value?.links) ? footerContent.value.links : [];
  return links
    .filter((link) => link && typeof link === 'object')
    .map((link) => {

    const href = typeof link.href === 'string' ? link.href.trim() : '';
      const explicitExternal = link.external === true;
      const explicitInternal = link.external === false;
      const implicitExternal = !explicitInternal && /^https?:\/\//i.test(href);
      const isExternal = explicitExternal || implicitExternal;

      const target = isExternal ? '_blank' : link.target || null;
      const rel = isExternal ? 'noopener noreferrer' : link.rel || null;

      return {
        ...link,
        href,
        target,
        rel,
      };
    });
});
const footerDisclaimer = computed(() => footerContent.value?.disclaimer || '');
</script>

<style scoped>
.brand-footer {
  background: var(
    --footer-bg,
    color-mix(in srgb, var(--brand-bg-900, #070410) 88%, var(--brand-bg-800, #120b1f) 12%)
  );
  color: var(--footer-text, var(--ui-text-primary, var(--brand-card-text, #f0eaf3)));
  padding: 48px 0 28px;
}

.footer-grid {
  display: grid;
  gap: 20px;
  text-align: center;
  justify-items: center;
}

.footer-logo img {
  max-width: 160px;
}

.footer-text {
  max-width: 520px;
  margin: 0;
  color: var(--footer-text, var(--ui-text-primary, var(--brand-card-text, #f0eaf3)));
  font-size: 0.9rem;
  line-height: 1.55;
}

.footer-disclaimer {
  margin: 0 auto;
  max-width: min(100%, 760px);
  font-size: 0.75rem;
  font-style: italic;
  line-height: 1.6;
  color: var(
    --footer-disclaimer,
    color-mix(in srgb, var(--ui-text-muted, var(--brand-card-text, #f0eaf3)) 70%, transparent)
  );
}

.footer-links {
  display: flex;
  gap: 18px;
  justify-content: center;
  flex-wrap: wrap;
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.footer-link {
  color: var(
    --footer-link-color,
    color-mix(in srgb, var(--ui-text-primary, var(--brand-card-text, #f0eaf3)) 75%, transparent)
  );
  text-decoration: none;
  transition: color 0.2s ease, text-decoration 0.2s ease;
}

.footer-link:hover,
.footer-link:focus-visible {
  color: var(--footer-link-hover, var(--brand-accent-electric, #27f3ff));
  text-decoration: underline;
}

@media (prefers-reduced-motion: reduce) {
  .footer-link {
    transition: none;
  }
}

@media (min-width: 992px) {
  .footer-text,
  .footer-disclaimer {
    max-width: 760px;
  }
}
</style>
