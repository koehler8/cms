import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cloneConfig, mergeConfigTrees, createConfigLoader } from '../../src/utils/loadConfig.js';

describe('cloneConfig', () => {
  it('deep-clones objects', () => {
    const original = { a: { b: 1 } };
    const cloned = cloneConfig(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.a).not.toBe(original.a);
  });

  it('deep-clones arrays', () => {
    const original = [{ a: 1 }, { b: 2 }];
    const cloned = cloneConfig(original);
    expect(cloned).toEqual(original);
    expect(cloned[0]).not.toBe(original[0]);
  });

  it('returns primitives as-is', () => {
    expect(cloneConfig(42)).toBe(42);
    expect(cloneConfig('hello')).toBe('hello');
    expect(cloneConfig(null)).toBeNull();
    expect(cloneConfig(undefined)).toBeUndefined();
  });
});

describe('mergeConfigTrees', () => {
  it('deep-merges nested objects', () => {
    const target = { a: { b: 1, c: 2 } };
    const source = { a: { c: 3, d: 4 } };
    const result = mergeConfigTrees(target, source);
    expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
  });

  it('merges arrays by index', () => {
    const target = [{ a: 1 }, { b: 2 }];
    const source = [{ a: 10 }];
    const result = mergeConfigTrees(target, source);
    expect(result[0]).toEqual({ a: 10 });
    expect(result[1]).toEqual({ b: 2 });
  });

  it('skips empty values with skipEmpty: true (default)', () => {
    const target = { a: 'original', b: 'keep' };
    const source = { a: '', b: null };
    const result = mergeConfigTrees(target, source);
    expect(result.a).toBe('original');
    expect(result.b).toBe('keep');
  });

  it('preserves empty values with skipEmpty: false', () => {
    const target = { a: 'original' };
    const source = { a: '' };
    const result = mergeConfigTrees(target, source, { skipEmpty: false });
    expect(result.a).toBe('');
  });

  it('skips empty arrays when skipEmpty is true', () => {
    const target = { items: ['a', 'b'] };
    const source = { items: [] };
    const result = mergeConfigTrees(target, source);
    expect(result.items).toEqual(['a', 'b']);
  });

  it('skips empty objects when skipEmpty is true', () => {
    const target = { meta: { title: 'Hello' } };
    const source = { meta: {} };
    const result = mergeConfigTrees(target, source);
    expect(result.meta).toEqual({ title: 'Hello' });
  });

  it('clones target when cloneTarget is true', () => {
    const target = { a: { b: 1 } };
    const source = { a: { c: 2 } };
    const result = mergeConfigTrees(target, source, { cloneTarget: true });
    expect(result.a).toEqual({ b: 1, c: 2 });
    expect(target.a).toEqual({ b: 1 }); // original unchanged
  });

  it('source overwrites target on type mismatch', () => {
    const target = { a: 'string' };
    const source = { a: { nested: true } };
    const result = mergeConfigTrees(target, source);
    expect(result.a).toEqual({ nested: true });
  });

  it('handles source being a primitive (replaces target)', () => {
    const result = mergeConfigTrees({ a: 1 }, 'replaced');
    expect(result).toBe('replaced');
  });

  it('adds new keys from source', () => {
    const result = mergeConfigTrees({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe('createConfigLoader', () => {
  function makeModules(files) {
    const modules = {};
    for (const [path, data] of Object.entries(files)) {
      modules[path] = () => Promise.resolve({ default: data });
    }
    return modules;
  }

  it('loads site.json and shared.json from content/en/', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test Site' },
      '/site/content/en/shared.json': { 'footer.text': 'Footer' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData();
    expect(config.site).toEqual({ title: 'Test Site' });
    expect(config.shared).toEqual({ footer: { text: 'Footer' } });
  });

  it('loads page configs from content/en/pages/', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/en/pages/home.json': { title: 'Home', components: [] },
      '/site/content/en/pages/about.json': { title: 'About', components: [] },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData();
    expect(config.pages.home).toEqual({ title: 'Home', components: [] });
    expect(config.pages.about).toEqual({ title: 'About', components: [] });
  });

  it('defaults shared to empty object when missing', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData();
    expect(config.shared).toEqual({});
  });

  it('throws when site.json is not found', async () => {
    const loader = createConfigLoader({});
    await expect(loader.loadConfigData()).rejects.toThrow('Config file not found');
  });

  it('merges locale overrides from split locale directory', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'English Site' },
      '/site/content/es/site.json': { title: 'Sitio Español' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData({ locale: 'es' });
    expect(config.site.title).toBe('Sitio Español');
  });

  it('falls back to base locale for keys not overridden', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'English Site', url: 'https://example.com' },
      '/site/content/en/shared.json': { 'footer.text': 'English footer' },
      '/site/content/de/site.json': { title: 'Deutsche Seite' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData({ locale: 'de' });
    expect(config.site.title).toBe('Deutsche Seite');
    expect(config.site.url).toBe('https://example.com');
    expect(config.shared).toEqual({ footer: { text: 'English footer' } });
  });

  it('normalizes locale to lowercase', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/fr/site.json': { title: 'Test FR' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData({ locale: 'FR' });
    expect(config.site.title).toBe('Test FR');
  });

  it('inflates flat dot-notation keys in content files', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/en/pages/home.json': {
        'content.hero.title': 'Welcome',
        'content.hero.subtitle': 'Hello world',
        'components[0].name': 'Hero',
      },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData();
    expect(config.pages.home.content.hero.title).toBe('Welcome');
    expect(config.pages.home.content.hero.subtitle).toBe('Hello world');
    expect(config.pages.home.components[0].name).toBe('Hero');
  });

  it('normalizes component entries (enabled defaults, trimming)', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/en/pages/home.json': {
        'components[0].name': ' Hero ',
        'components[0].configKey': ' hero ',
        'components[0].source': ' ext ',
        'components[1].name': 'Footer',
        'components[1].enabled': false,
      },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData({ locale: 'en' });
    const components = config.pages.home.components;
    expect(components[0].name).toBe('Hero');
    expect(components[0].configKey).toBe('hero');
    expect(components[0].source).toBe('ext');
    expect(components[0].enabled).toBe(true);
    expect(components[1].enabled).toBe(false);
  });

  it('accepts locale as a string shorthand', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/de/site.json': { title: 'Test DE' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData('de');
    expect(config.site.title).toBe('Test DE');
  });

  it('accepts locale as an array (takes first valid)', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/ja/site.json': { title: 'Test JA' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData([null, '', 'ja']);
    expect(config.site.title).toBe('Test JA');
  });

  it('defaults baseLocale to en when content.config.json is missing', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': {},
      '/site/content/en/site.json': { title: 'Default Base' },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData();
    expect(config.site.title).toBe('Default Base');
  });

  it('merges locale page overrides on top of base pages', async () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/en/pages/home.json': {
        'content.hero.title': 'Welcome',
        'content.hero.cta': 'Sign Up',
      },
      '/site/content/fr/pages/home.json': {
        'content.hero.title': 'Bienvenue',
      },
    });
    const loader = createConfigLoader(modules);
    const config = await loader.loadConfigData({ locale: 'fr' });
    expect(config.pages.home.content.hero.title).toBe('Bienvenue');
    expect(config.pages.home.content.hero.cta).toBe('Sign Up');
  });

  it('discovers available locales from allModules keys', () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
      '/site/content/en/pages/home.json': { 'content.title': 'Home' },
      '/site/content/de/site.json': { title: 'Test DE' },
      '/site/content/ja/pages/home.json': { 'content.title': 'ホーム' },
    });
    const loader = createConfigLoader(modules);
    expect(loader.availableLocales).toEqual(['de', 'en', 'ja']);
  });

  it('returns only en for English-only sites', () => {
    const modules = makeModules({
      '/site/content/content.config.json': { baseLocale: 'en' },
      '/site/content/en/site.json': { title: 'Test' },
    });
    const loader = createConfigLoader(modules);
    expect(loader.availableLocales).toEqual(['en']);
  });
});
