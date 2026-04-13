import { computed } from 'vue';
import { useHead } from '@unhead/vue';

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

export function usePageMeta({ siteData, currentPage }) {
  const siteTitle = computed(() => siteData.value?.site?.title || '');
  const siteDescription = computed(() => siteData.value?.site?.description || '');

  const pageMetaTitle = computed(() => {
    const page = currentPage.value;
    const site = siteTitle.value;
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
    const explicitDescription = currentPage.value?.meta?.description;
    if (explicitDescription && explicitDescription.trim()) {
      return explicitDescription.trim();
    }
    return siteDescription.value || '';
  });

  useHead(() => {
    const description = pageMetaDescription.value;
    const meta = description
      ? [{ name: 'description', content: description, key: 'description' }]
      : [];
    return {
      title: pageMetaTitle.value,
      meta,
    };
  });

  return { pageMetaTitle, pageMetaDescription };
}
