/**
 * Build per-page Open Graph + Twitter Card meta entries.
 *
 * Returns an array of @unhead/vue meta descriptors ready to be spread into
 * useHead's `meta:` array. Returns [] for drafts and 404 pages — drafts
 * shouldn't be advertised socially, and 404 cards would mislead.
 *
 * Title and description are passed in pre-resolved (the caller — usually
 * usePageMeta — already computes them with the site-wide fallback chain).
 *
 * og:image priority:
 *   1. page.meta.image (per-page override; e.g. an article hero)
 *   2. site.image / site.ogImage (site-wide override authored in site.json)
 *   3. /og-image.jpg (the static asset cms-generate-public-assets writes)
 *
 * Relative image paths get an absolute URL built from site.url. If
 * site.url is missing, the relative path is emitted as-is — most social
 * scrapers won't follow it, but that's better than emitting nothing.
 */

const STATIC_OG_IMAGE = '/og-image.jpg';

function absolutize(siteUrl, pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!siteUrl) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${siteUrl}${path}`;
}

export function buildSocialMeta({
  siteData,
  currentPage,
  pageTitle,
  pageDescription,
  canonicalHref,
  isDraft,
  isNotFound,
} = {}) {
  if (isDraft || isNotFound) return [];

  const site = (siteData && siteData.site) || {};
  const page = currentPage || {};
  const pageMeta = page.meta || {};

  const siteUrl = (typeof site.url === 'string' ? site.url : '').trim().replace(/\/+$/, '');
  const siteTitle = typeof site.title === 'string' ? site.title.trim() : '';

  const rawImage =
    pageMeta.image ||
    site.image ||
    site.ogImage ||
    STATIC_OG_IMAGE;
  const ogImage = absolutize(siteUrl, rawImage);

  const ogType = pageMeta.ogType || 'website';
  const twitterCard = pageMeta.twitterCard || 'summary_large_image';

  const meta = [];

  if (pageTitle) {
    meta.push({ property: 'og:title', content: pageTitle, key: 'og:title' });
    meta.push({ name: 'twitter:title', content: pageTitle, key: 'twitter:title' });
  }
  if (pageDescription) {
    meta.push({ property: 'og:description', content: pageDescription, key: 'og:description' });
    meta.push({ name: 'twitter:description', content: pageDescription, key: 'twitter:description' });
  }
  if (canonicalHref) {
    meta.push({ property: 'og:url', content: canonicalHref, key: 'og:url' });
  }
  meta.push({ property: 'og:type', content: ogType, key: 'og:type' });
  if (siteTitle) {
    meta.push({ property: 'og:site_name', content: siteTitle, key: 'og:site_name' });
  }
  if (ogImage) {
    meta.push({ property: 'og:image', content: ogImage, key: 'og:image' });
    meta.push({ name: 'twitter:image', content: ogImage, key: 'twitter:image' });
  }
  meta.push({ name: 'twitter:card', content: twitterCard, key: 'twitter:card' });

  return meta;
}
