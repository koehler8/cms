import { describe, it, expect } from 'vitest';
import { buildWebAppManifest } from '../../src/utils/webAppManifest.js';

describe('buildWebAppManifest', () => {
  it('uses site.title as name when manifest.name is not set', () => {
    const m = buildWebAppManifest({ site: { title: 'My Site' } });
    expect(m.name).toBe('My Site');
  });

  it('uses manifest.name override', () => {
    const m = buildWebAppManifest({ site: { title: 'My Site', manifest: { name: 'Override' } } });
    expect(m.name).toBe('Override');
  });

  it('falls back to "Site" when no title and no name', () => {
    const m = buildWebAppManifest({ site: {} });
    expect(m.name).toBe('Site');
  });

  it('truncates long titles for short_name', () => {
    const m = buildWebAppManifest({
      site: { title: 'A Very Long Marketing Site Name' },
    });
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.short_name).toBe('A Very Long ');
  });

  it('respects manifest.shortName override', () => {
    const m = buildWebAppManifest({
      site: { title: 'Long Site', manifest: { shortName: 'LS' } },
    });
    expect(m.short_name).toBe('LS');
  });

  it('uses defaults when nothing is configured', () => {
    const m = buildWebAppManifest({ site: { title: 'X' } });
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#ffffff');
    expect(m.background_color).toBe('#ffffff');
  });

  it('respects manifest overrides for colors / startUrl / display', () => {
    const m = buildWebAppManifest({
      site: {
        title: 'X',
        manifest: {
          themeColor: '#0F5159',
          backgroundColor: '#FBF6ED',
          startUrl: '/home',
          display: 'minimal-ui',
        },
      },
    });
    expect(m.theme_color).toBe('#0F5159');
    expect(m.background_color).toBe('#FBF6ED');
    expect(m.start_url).toBe('/home');
    expect(m.display).toBe('minimal-ui');
  });

  it('emits default icons referencing public assets', () => {
    const m = buildWebAppManifest({ site: { title: 'X' } });
    expect(m.icons).toBeInstanceOf(Array);
    expect(m.icons[0].src).toBe('/favicon-256.png');
    expect(m.icons[0].sizes).toBe('256x256');
    expect(m.icons[1].src).toBe('/favicon.ico');
  });

  it('respects manifest.icons override', () => {
    const m = buildWebAppManifest({
      site: {
        title: 'X',
        manifest: {
          icons: [{ src: '/custom-512.png', sizes: '512x512', type: 'image/png' }],
        },
      },
    });
    expect(m.icons).toHaveLength(1);
    expect(m.icons[0].src).toBe('/custom-512.png');
  });

  it('filters invalid icon entries (missing src)', () => {
    const m = buildWebAppManifest({
      site: {
        title: 'X',
        manifest: {
          icons: [
            { src: '/ok.png', sizes: '256x256' },
            { sizes: '512x512' }, // no src — drop
            null, // not an object — drop
          ],
        },
      },
    });
    expect(m.icons).toHaveLength(1);
  });

  it('falls back to default icons when override is empty/all-invalid', () => {
    const m = buildWebAppManifest({
      site: { title: 'X', manifest: { icons: [{ sizes: '512x512' }] } },
    });
    expect(m.icons[0].src).toBe('/favicon-256.png');
  });

  it('emits description when set on site or manifest', () => {
    const a = buildWebAppManifest({ site: { title: 'X', description: 'Hi' } });
    expect(a.description).toBe('Hi');
    const b = buildWebAppManifest({
      site: { title: 'X', manifest: { description: 'Override' } },
    });
    expect(b.description).toBe('Override');
  });

  it('omits description when neither is set', () => {
    const m = buildWebAppManifest({ site: { title: 'X' } });
    expect(m.description).toBeUndefined();
  });

  it('emits lang when set on manifest', () => {
    const m = buildWebAppManifest({
      site: { title: 'X', manifest: { lang: 'en-US' } },
    });
    expect(m.lang).toBe('en-US');
  });

  it('handles missing siteConfig gracefully', () => {
    const m = buildWebAppManifest(null);
    expect(m.name).toBe('Site');
    expect(m.icons).toBeInstanceOf(Array);
  });
});
