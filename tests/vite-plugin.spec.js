import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// We can't import the full Vite plugin (it relies on Vite + vue plugin),
// but we can test the pure helper functions by extracting them.
// Since they're not exported, we'll test via the module's internal behavior
// by re-implementing the testable functions inline from the source.

// These are pure functions extracted from vite-plugin.js for testability:

function normalizeRoutePath(value = '/') {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/+/g, '/');
  normalized = normalized.replace(/\/$/, '');
  return normalized || '/';
}

function collectPagePaths(config) {
  if (!config || typeof config !== 'object') return ['/'];
  const pages = config.pages || {};
  const paths = new Set(['/']);
  Object.values(pages).forEach((page) => {
    if (!page || typeof page !== 'object') return;
    if ('path' in page) {
      paths.add(normalizeRoutePath(page.path));
    }
  });
  return Array.from(paths);
}

function extractSiteMetadata(siteConfig) {
  const {
    title: siteTitle = '',
    description: siteDescription = '',
    url: siteUrl = '',
    googleId: siteGoogleId = '',
    sameAs: siteSameAs = [],
  } = siteConfig.site || {};

  const siteSameAsList = Array.isArray(siteSameAs)
    ? siteSameAs.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  const siteSameAsJson = JSON.stringify(siteSameAsList);

  return { siteTitle, siteDescription, siteUrl, siteGoogleId, siteSameAsJson };
}

const htmlEscape = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

describe('vite-plugin helpers', () => {
  describe('normalizeRoutePath', () => {
    it('adds leading slash', () => {
      expect(normalizeRoutePath('about')).toBe('/about');
    });

    it('removes trailing slash', () => {
      expect(normalizeRoutePath('/about/')).toBe('/about');
    });

    it('collapses multiple slashes', () => {
      expect(normalizeRoutePath('//about///page')).toBe('/about/page');
    });

    it('returns "/" for empty input', () => {
      expect(normalizeRoutePath('')).toBe('/');
      expect(normalizeRoutePath('   ')).toBe('/');
    });

    it('returns "/" for non-string input', () => {
      expect(normalizeRoutePath(null)).toBe('/');
      expect(normalizeRoutePath(42)).toBe('/');
    });

    it('preserves root path', () => {
      expect(normalizeRoutePath('/')).toBe('/');
    });

    it('handles deep paths', () => {
      expect(normalizeRoutePath('/docs/api/v2')).toBe('/docs/api/v2');
    });
  });

  describe('collectPagePaths', () => {
    it('always includes root path', () => {
      expect(collectPagePaths(null)).toEqual(['/']);
      expect(collectPagePaths({})).toEqual(['/']);
    });

    it('collects paths from page configs', () => {
      const config = {
        pages: {
          about: { path: '/about' },
          team: { path: '/team' },
        },
      };
      const paths = collectPagePaths(config);
      expect(paths).toContain('/');
      expect(paths).toContain('/about');
      expect(paths).toContain('/team');
    });

    it('normalizes collected paths', () => {
      const config = {
        pages: {
          about: { path: 'about/' },
        },
      };
      const paths = collectPagePaths(config);
      expect(paths).toContain('/about');
    });

    it('skips pages without path property', () => {
      const config = {
        pages: {
          home: { title: 'Home' },
          about: { path: '/about' },
        },
      };
      const paths = collectPagePaths(config);
      expect(paths).toHaveLength(2);
    });
  });

  describe('extractSiteMetadata', () => {
    it('extracts metadata from site config', () => {
      const config = {
        site: {
          title: 'Test Site',
          description: 'A test site',
          url: 'https://example.com',
          googleId: 'G-12345',
          sameAs: ['https://twitter.com/test', 'https://github.com/test'],
        },
      };
      const meta = extractSiteMetadata(config);
      expect(meta.siteTitle).toBe('Test Site');
      expect(meta.siteDescription).toBe('A test site');
      expect(meta.siteUrl).toBe('https://example.com');
      expect(meta.siteGoogleId).toBe('G-12345');
      expect(JSON.parse(meta.siteSameAsJson)).toEqual([
        'https://twitter.com/test',
        'https://github.com/test',
      ]);
    });

    it('defaults all fields when site is missing', () => {
      const meta = extractSiteMetadata({});
      expect(meta.siteTitle).toBe('');
      expect(meta.siteDescription).toBe('');
      expect(meta.siteUrl).toBe('');
      expect(meta.siteGoogleId).toBe('');
      expect(meta.siteSameAsJson).toBe('[]');
    });

    it('filters non-string sameAs entries', () => {
      const meta = extractSiteMetadata({
        site: { sameAs: ['valid', '', null, 42, 'also-valid'] },
      });
      expect(JSON.parse(meta.siteSameAsJson)).toEqual(['valid', 'also-valid']);
    });
  });

  describe('htmlEscape', () => {
    it('escapes HTML special characters', () => {
      expect(htmlEscape('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('escapes ampersand', () => {
      expect(htmlEscape('a & b')).toBe('a &amp; b');
    });

    it('escapes single quotes', () => {
      expect(htmlEscape("it's")).toBe('it&#39;s');
    });

    it('handles null/undefined', () => {
      expect(htmlEscape(null)).toBe('');
      expect(htmlEscape(undefined)).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Real-plugin tests (import the actual module, not re-implemented copies).
// ---------------------------------------------------------------------------
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { validateExtensionManifests } from '../vite-plugin.js';

describe('validateExtensionManifests (build-time gate)', () => {
  let projectRoot;
  const frameworkDir = path.resolve(__dirname, '..');

  const writeManifest = (relDir, manifest) => {
    const dir = path.join(projectRoot, relDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'extension.config.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
    );
  };

  const validManifest = {
    slug: 'my-ext',
    version: '1.0.0',
    provider: { name: 'Test' },
    license: 'MIT',
    components: [
      { name: 'MyThing', label: 'My Thing', description: 'A thing', configKey: 'myThing' },
    ],
  };

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(os.tmpdir(), 'cms-manifest-validate-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('passes a valid site-local extension manifest', async () => {
    writeManifest('extensions/my-ext', validManifest);
    await expect(
      validateExtensionManifests(['./extensions/my-ext'], projectRoot, frameworkDir),
    ).resolves.toEqual([
      { spec: './extensions/my-ext', slug: 'my-ext', componentNames: new Set(['MyThing']) },
    ]);
  });

  it('passes a valid npm-package extension manifest', async () => {
    writeManifest('node_modules/@koehler8/cms-ext-test', validManifest);
    await expect(
      validateExtensionManifests(['@koehler8/cms-ext-test'], projectRoot, frameworkDir),
    ).resolves.toEqual([
      { spec: '@koehler8/cms-ext-test', slug: 'my-ext', componentNames: new Set(['MyThing']) },
    ]);
  });

  it('fails the build on a schema violation, naming the spec and the field', async () => {
    writeManifest('extensions/bad-ext', {
      ...validManifest,
      slug: 'Bad Slug With Spaces',
    });
    await expect(
      validateExtensionManifests(['./extensions/bad-ext'], projectRoot, frameworkDir),
    ).rejects.toThrow(/bad-ext[\s\S]*slug/);
  });

  it('fails the build on unparseable manifest JSON', async () => {
    writeManifest('extensions/broken', '{ not json');
    await expect(
      validateExtensionManifests(['./extensions/broken'], projectRoot, frameworkDir),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('warns but does not fail when a spec has no manifest file', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        validateExtensionManifests(['./extensions/absent'], projectRoot, frameworkDir),
      ).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no extension.config.json'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('validates the real cms-ext-compliance manifest in the workspace, if present', async () => {
    const compliancePath = path.resolve(frameworkDir, '..', 'cms-ext-compliance');
    if (!fs.existsSync(path.join(compliancePath, 'extension.config.json'))) return;
    const info = await validateExtensionManifests(['../cms-ext-compliance'], frameworkDir, frameworkDir);
    expect(info).toHaveLength(1);
    expect(info[0].slug).toBe('compliance');
    expect(info[0].componentNames.size).toBeGreaterThan(0);
  });
});

import { collectComponentRefProblems } from '../vite-plugin.js';

describe('collectComponentRefProblems (build-time components[] gate)', () => {
  const base = {
    bundledNames: new Set(['Header', 'Hero', 'Footer', 'Spacer']),
    siteNames: new Set(['MyCustom']),
    extensions: [{ slug: 'compliance', componentNames: new Set(['Privacy', 'Legal']) }],
  };

  it('passes bundled, site, extension, and qualified references', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: {
        en: {
          home: { components: ['Header', 'MyCustom', 'Privacy', 'site:MyCustom', 'compliance:Legal'] },
          about: { components: [{ name: 'Hero', configKey: 'promo' }, { name: 'Privacy', source: 'compliance' }] },
        },
      },
    });
    expect(problems).toEqual([]);
  });

  it('flags an unknown bare name with the page, locale, and index', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: { en: { home: { components: ['Header', 'Herro'] } } },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('pages/home.json');
    expect(problems[0]).toContain('locale en');
    expect(problems[0]).toContain('components[1]');
    expect(problems[0]).toContain('"Herro"');
  });

  it('suggests the canonical name on a case mismatch', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: { en: { home: { components: ['hero'] } } },
    });
    expect(problems[0]).toContain('did you mean "Hero"?');
  });

  it('flags unknown extension sources and undeclared extension components', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: {
        en: { home: { components: ['nope:Privacy', { name: 'Terms', source: 'compliance' }] } },
      },
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('unknown extension source "nope"');
    expect(problems[1]).toContain('extension "compliance" declares no component "Terms"');
  });

  it('flags a missing site-local component', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: { en: { home: { components: ['site:Missing'] } } },
    });
    expect(problems[0]).toContain('no site/components/Missing.vue');
  });

  it('checks non-base locales too', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: { en: { home: { components: ['Header'] } }, de: { home: { components: ['Kopfzeile'] } } },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('locale de');
  });

  it('ignores empty entries and non-array components', () => {
    const problems = collectComponentRefProblems({
      ...base,
      pagesByLocale: { en: { a: { components: ['', null, {}] }, b: {}, c: { components: 'Header' } } },
    });
    expect(problems).toEqual([]);
  });
});
