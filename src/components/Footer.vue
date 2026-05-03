<template>
  <footer class="site-footer ui-footer" data-analytics-section="footer">
    <div class="container ui-footer__grid">
      <div class="ui-footer__brand">
        <a class="ui-footer__logo" href="/">
          <img
            :src="logoSrc"
            :alt="`${siteName} – home`"
            class="site-footer__logo-img"
            loading="lazy"
            decoding="async"
          />
        </a>
        <p class="ui-footer__text">{{ footerText }}</p>
      </div>
      <div v-if="footerLinks.length" class="ui-footer__links">
        <p class="ui-footer__heading ui-label-sm">Links</p>
        <nav aria-label="Footer links">
          <ul class="ui-footer__nav">
            <li v-for="(link, idx) in footerLinks" :key="idx">
              <a
                class="ui-footer__link"
                :href="link.href"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{{ link.text }}</span>
                <span class="ui-footer__sr-only">(opens in a new tab)</span>
                <span class="ui-footer__link-icon" aria-hidden="true">&gt;</span>
              </a>
            </li>
          </ul>
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
const footerContent = computed(() => pageContent.value?.footer || {});

const footerText = computed(() => footerContent.value?.text || '');
const footerLinks = computed(() =>
  Array.isArray(footerContent.value?.links) ? footerContent.value.links : []
);
</script>

<style scoped>
.site-footer__logo-img {
  max-height: 48px;
  width: auto;
}

.ui-footer__text {
  margin-bottom: 0;
}

.ui-footer__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
