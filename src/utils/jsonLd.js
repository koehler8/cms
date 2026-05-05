/**
 * Normalize per-page + site-wide JSON-LD blocks into a flat list of
 * @unhead/vue script descriptors ready for `useHead({ script: [...] })`.
 *
 * Authoring conventions in `pages/{id}.json` and `site.json`:
 *
 *   "jsonld": { "@context": "https://schema.org", "@type": "Article", ... }
 *
 * or for multiple blocks on a page:
 *
 *   "jsonld": [
 *     { "@type": "Article", ... },
 *     { "@type": "BreadcrumbList", ... }
 *   ]
 *
 * Page blocks ALWAYS append to site blocks (there's no "override" semantic
 * — each schema.org block is an independent assertion, so listing both is
 * the right behavior for a sitewide Organization + a page-specific Article).
 *
 * Skipped entirely on drafts and 404s; structured data on those would
 * mislead crawlers (drafts shouldn't be indexed; 404s aren't authoritative).
 */

function normalizeBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  // Inject the schema.org @context if the author omitted it. JSON-LD blocks
  // without @context are ignored by all major consumers, so adding it
  // defensively is the right default.
  if (!block['@context']) {
    return { '@context': 'https://schema.org', ...block };
  }
  return block;
}

function collectBlocks(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(normalizeBlock).filter(Boolean);
  }
  const single = normalizeBlock(input);
  return single ? [single] : [];
}

export function buildJsonLdScripts({ siteData, currentPage, isDraft, isNotFound } = {}) {
  if (isDraft || isNotFound) return [];

  const siteBlocks = collectBlocks(siteData?.site?.jsonld);
  const pageBlocks = collectBlocks(currentPage?.jsonld);

  const all = [...siteBlocks, ...pageBlocks];
  if (all.length === 0) return [];

  return all.map((block, i) => ({
    type: 'application/ld+json',
    innerHTML: JSON.stringify(block),
    key: `jsonld-${block['@type'] || 'block'}-${i}`,
  }));
}
