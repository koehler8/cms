import { computed } from 'vue';
import { useHead } from '@unhead/vue';
import { isPathDraft } from '../utils/draftMode.js';
import { buildCanonicalUrl } from '../utils/canonicalUrl.js';
import { buildSocialMeta } from '../utils/socialMeta.js';
import { buildJsonLdScripts } from '../utils/jsonLd.js';
import { buildBreadcrumbList } from '../utils/breadcrumbs.js';
import { availableLocales as configAvailableLocales, baseLocale as configBaseLocale } from '../utils/loadConfig.js';

// Site-verification meta-tag names per platform. Authors set
// `site.siteVerification.<platform>` in site.json with the token issued by
// the platform's webmaster console; we emit one <meta> per platform.
const SITE_VERIFICATION_META = {
  google: 'google-site-verification',
  bing: 'msvalidate.01',
  yandex: 'yandex-verification',
  pinterest: 'p:domain_verify',
  facebook: 'facebook-domain-verification',
};

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
  const isNotFound = computed(() => Boolean(currentPage.value?.isNotFound));

  const pageMetaTitle = computed(() => {
    const page = currentPage.value;
    const site = siteTitle.value;
    // 404 pages: generic "Page not found — Site". The page slug (which is
    // some URL the visitor typed) shouldn't leak into <title>.
    if (isNotFound.value) {
      return site ? `Page not found — ${site}` : 'Page not found';
    }
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
    if (isDraft.value || isNotFound.value) {
      return '';
    }
    const explicitDescription = currentPage.value?.meta?.description;
    if (explicitDescription && explicitDescription.trim()) {
      return explicitDescription.trim();
    }
    return siteDescription.value || '';
  });

  // Canonical URL — base-locale URLs have no prefix; non-base locales get
  // /{locale}/path. Drafts and 404s skip canonical (the URL itself isn't
  // authoritative for gated/missing content). Sites without a configured
  // site.url skip too — we can't build an absolute URL.
  const canonicalHref = computed(() => {
    if (isDraft.value || isNotFound.value) return '';
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
    if (isDraft.value || isNotFound.value) return [];
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
    // 404 pages get noindex defensively — Amplify (or whichever host)
    // already serves them with HTTP 404, but search engines occasionally
    // crawl 404 URLs and the meta is a stronger signal than relying on
    // the status header alone.
    if (isDraft.value || isNotFound.value) {
      meta.push({ name: 'robots', content: 'noindex, nofollow', key: 'robots' });
    }
    const social = buildSocialMeta({
      siteData: siteData.value,
      currentPage: currentPage.value,
      pageTitle: pageMetaTitle.value,
      pageDescription: pageMetaDescription.value,
      canonicalHref: canonicalHref.value,
      isDraft: isDraft.value,
      isNotFound: isNotFound.value,
    });
    for (const entry of social) meta.push(entry);

    // Site-verification meta tags. These are emitted on every page (not
    // just home) — verification platforms typically only check homepage
    // but emitting site-wide is harmless and matches what most CMSs do.
    const verification = siteData.value?.site?.siteVerification;
    if (verification && typeof verification === 'object') {
      for (const [platform, token] of Object.entries(verification)) {
        const metaName = SITE_VERIFICATION_META[platform];
        if (!metaName) continue;
        if (typeof token !== 'string') continue;
        const trimmed = token.trim();
        if (!trimmed) continue;
        meta.push({ name: metaName, content: trimmed, key: `verify-${platform}` });
      }
    }

    const link = [];
    if (canonicalHref.value) {
      link.push({ rel: 'canonical', href: canonicalHref.value, key: 'canonical' });
    }
    for (const entry of hreflangLinks.value) {
      link.push(entry);
    }

    const script = buildJsonLdScripts({
      siteData: siteData.value,
      currentPage: currentPage.value,
      isDraft: isDraft.value,
      isNotFound: isNotFound.value,
    });

    // Auto-generated BreadcrumbList JSON-LD. Appended after any
    // author-supplied jsonld blocks so authors can override by emitting a
    // hand-authored BreadcrumbList of their own (Google takes the first
    // valid one when multiple are present).
    const breadcrumb = buildBreadcrumbList({
      siteUrl: siteUrl.value,
      currentPage: currentPage.value,
      pages: siteData.value?.pages,
      baseLocale: configBaseLocale,
      locale: localeValue.value,
    });
    if (breadcrumb && !isDraft.value && !isNotFound.value) {
      script.push({
        type: 'application/ld+json',
        innerHTML: JSON.stringify(breadcrumb),
        key: 'jsonld-BreadcrumbList',
      });
    }

    return {
      title: pageMetaTitle.value,
      meta,
      link,
      script,
    };
  });

  return { pageMetaTitle, pageMetaDescription, isDraft, isNotFound, canonicalHref, hreflangLinks };
}
