/**
 * Build a JSON-LD `BreadcrumbList` for the current page from URL path
 * segments and the inflated pages map. Drives Google's breadcrumb display
 * in search results without authors having to hand-author the schema.
 *
 * Returns `null` when breadcrumbs aren't applicable (home, draft, 404,
 * single-segment path with no resolvable hierarchy, missing site.url, or
 * per-page opt-out via `currentPage.meta.breadcrumbs === false`).
 *
 * Label resolution priority for each path prefix `/seg1/seg2/...`:
 *   1. A page in the inflated config whose `path` matches → its
 *      `meta.title`, falling back to a slug-derived title-case label.
 *   2. Otherwise → the last segment formatted (`my-post-title` →
 *      `My Post Title`).
 *
 * The first entry is always `Home` linked at the canonical home URL. The
 * last entry is the current page; its `item` URL is included (Google
 * accepts both forms; including is more interoperable).
 */

import { buildCanonicalUrl } from './canonicalUrl.js';

function normalizePath(value) {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let p = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  p = p.replace(/\/+/g, '/').replace(/\/+$/, '');
  return p || '/';
}

function titleCaseSlug(slug) {
  if (typeof slug !== 'string') return '';
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findPageByPath(pages, targetPath) {
  if (!pages || typeof pages !== 'object') return null;
  const norm = normalizePath(targetPath);
  for (const data of Object.values(pages)) {
    if (!data || typeof data !== 'object') continue;
    if (normalizePath(data.path) === norm) return data;
  }
  return null;
}

function resolveLabel(pages, prefixPath, lastSegment) {
  const page = findPageByPath(pages, prefixPath);
  const explicitTitle = page?.meta?.title;
  if (typeof explicitTitle === 'string' && explicitTitle.trim()) {
    return explicitTitle.trim();
  }
  return titleCaseSlug(lastSegment) || lastSegment || '';
}

export function buildBreadcrumbList({
  siteUrl,
  currentPage,
  pages,
  baseLocale,
  locale,
} = {}) {
  if (!currentPage || typeof currentPage !== 'object') return null;
  if (currentPage.isNotFound) return null;
  if (currentPage.draft === true) return null;
  if (currentPage.meta && currentPage.meta.breadcrumbs === false) return null;

  const host = (typeof siteUrl === 'string' ? siteUrl : '').trim().replace(/\/+$/, '');
  if (!host) return null;

  const targetPath = normalizePath(currentPage.path);
  if (targetPath === '/' || targetPath === '') return null;

  const segments = targetPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const homeHref = buildCanonicalUrl({
    siteUrl: host,
    locale,
    baseLocale,
    path: '/',
  });

  const items = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: homeHref,
    },
  ];

  for (let i = 0; i < segments.length; i++) {
    const prefixPath = `/${segments.slice(0, i + 1).join('/')}`;
    const href = buildCanonicalUrl({
      siteUrl: host,
      locale,
      baseLocale,
      path: prefixPath,
    });
    items.push({
      '@type': 'ListItem',
      position: items.length + 1,
      name: resolveLabel(pages, prefixPath, segments[i]),
      item: href,
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}
