<template>
  <footer class="site-footer ui-footer" data-analytics-section="footer">
    <div class="container ui-footer__grid">
      <div class="ui-footer__brand">
        <a class="ui-footer__logo" href="/" aria-label="Return home">
          <img
            :src="logoSrc"
            :alt="siteName"
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
</style>
