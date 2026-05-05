import { computed } from 'vue';
import { useHead } from '@unhead/vue';
import { isPathDraft } from '../utils/draftMode.js';
import { buildCanonicalUrl } from '../utils/canonicalUrl.js';
import { availableLocales as configAvailableLocales, baseLocale as configBaseLocale } from '../utils/loadConfig.js';

const SPECIAL_PAGE_LABELS = {
  home: '',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  cookies: 'Cookie Policy',
};

function inferPageLabel(page) {
  if (!page) return '';
  const id = (page.id || '').toLowerCase();
  if (id && SPECIAL_PAGE_LABELS[id] !== undefined) {
    return SPECIAL_PAGE_LABELS[id];
  }
  const path = (page.path || '').toLowerCase();
  if (path === '/' || path === '') {
    return '';
  }
  for (const [key, label] of Object.entries(SPECIAL_PAGE_LABELS)) {
    if (key === 'home') continue;
    if (path === `/${key}`) {
      return label;
    }
  }
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (!segments.length) return '';
  return segments
    .map((segment) =>
      segment
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    )
    .join(' / ');
}

export function usePageMeta({ siteData, currentPage, locale }) {
  const siteTitle = computed(() => siteData.value?.site?.title || '');
  const siteDescription = computed(() => siteData.value?.site?.description || '');
  const siteUrl = computed(() => siteData.value?.site?.url || '');
  const localeValue = computed(() => {
    if (typeof locale === 'function') return locale() || '';
    if (typeof locale === 'string') return locale;
    return '';
  });

  const isDraft = computed(() =>
    isPathDraft(siteData.value, currentPage.value?.path, currentPage.value),
  );

  const pageMetaTitle = computed(() => {
    const page = currentPage.value;
    const site = siteTitle.value;
    // Draft pages emit a generic title so the page slug doesn't leak via
    // <title> in the SSG-rendered HTML on disk. The tab title remains
    // generic even after client-side unlock — for "iterate before launch"
    // the URL bar already identifies the page.
    if (isDraft.value) {
      return site ? `Draft — ${site}` : 'Draft';
    }
    const explicitTitle = page?.meta?.title;
    if (explicitTitle) {
      return explicitTitle;
    }
    const label = inferPageLabel(page);
    if (!label) {
      return site;
    }
    return site ? `${label} — ${site}` : label;
  });

  const pageMetaDescription = computed(() => {
    if (isDraft.value) {
      return '';
    }
    const explicitDescription = currentPage.value?.meta?.description;
    if (explicitDescription && explicitDescription.trim()) {
      return explicitDescription.trim();
    }
    return siteDescription.value || '';
  });

  // Canonical URL — base-locale URLs have no prefix; non-base locales get
  // /{locale}/path. Drafts skip canonical (gated content shouldn't advertise
  // an authoritative URL). Sites without a configured site.url skip too —
  // we can't build an absolute URL.
  const canonicalHref = computed(() => {
    if (isDraft.value) return '';
    if (!siteUrl.value) return '';
    return buildCanonicalUrl({
      siteUrl: siteUrl.value,
      locale: localeValue.value,
      baseLocale: configBaseLocale,
      path: currentPage.value?.path || '/',
    });
  });

  // hreflang alternates — only emitted when a site has more than one
  // locale's content on disk. Includes one entry per available locale plus
  // an `x-default` pointing at the base-locale URL (Google's preferred
  // pattern for sites without explicit geo-targeting).
  const hreflangLinks = computed(() => {
    if (isDraft.value) return [];
    if (!siteUrl.value) return [];
    if (!Array.isArray(configAvailableLocales) || configAvailableLocales.length <= 1) return [];
    const path = currentPage.value?.path || '/';
    const links = [];
    for (const code of configAvailableLocales) {
      const href = buildCanonicalUrl({
        siteUrl: siteUrl.value,
        locale: code,
        baseLocale: configBaseLocale,
        path,
      });
      if (href) {
        links.push({ rel: 'alternate', hreflang: code, href, key: `hreflang-${code}` });
      }
    }
    const defaultHref = buildCanonicalUrl({
      siteUrl: siteUrl.value,
      locale: configBaseLocale,
      baseLocale: configBaseLocale,
      path,
    });
    if (defaultHref) {
      links.push({ rel: 'alternate', hreflang: 'x-default', href: defaultHref, key: 'hreflang-x-default' });
    }
    return links;
  });

  useHead(() => {
    const description = pageMetaDescription.value;
    const meta = [];
    if (description) {
      meta.push({ name: 'description', content: description, key: 'description' });
    }
    if (isDraft.value) {
      meta.push({ name: 'robots', content: 'noindex, nofollow', key: 'robots' });
    }
    const link = [];
    if (canonicalHref.value) {
      link.push({ rel: 'canonical', href: canonicalHref.value, key: 'canonical' });
    }
    for (const entry of hreflangLinks.value) {
      link.push(entry);
    }
    return {
      title: pageMetaTitle.value,
      meta,
      link,
    };
  });

  return { pageMetaTitle, pageMetaDescription, isDraft, canonicalHref, hreflangLinks };
}
