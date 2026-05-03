import { describe, it, expect } from 'vitest';
import { buildCssVarMap, renderCssVarRule } from '../../src/themes/buildCssVarMap.js';
import baseManifest from '../../themes/base/theme.config.js';

describe('buildCssVarMap', () => {
  it('returns an empty object for a missing manifest', () => {
    expect(buildCssVarMap()).toEqual({});
    expect(buildCssVarMap(null)).toEqual({});
    expect(buildCssVarMap(undefined)).toEqual({});
  });

  it('produces no `undefined--*` keys (regression for the assignPrefixed default-prefix bug)', () => {
    const vars = buildCssVarMap(baseManifest);
    const bad = Object.keys(vars).filter((k) => k.startsWith('undefined'));
    expect(bad).toEqual([]);
  });

  it('emits the documented core variables for the bundled base theme', () => {
    const vars = buildCssVarMap(baseManifest);
    expect(vars['--brand-primary']).toBeDefined();
    expect(vars['--brand-fg-100']).toBeDefined();
    expect(vars['--brand-bg-900']).toBeDefined();
    expect(vars['--brand-header-bg']).toBeDefined();
    expect(vars['--theme-body-background']).toBeDefined();
  });

  it('joins array bodyBackground entries with commas', () => {
    const manifest = {
      slug: 'test',
      tokens: {
        utility: {
          bodyBackground: ['linear-gradient(red, blue)', 'radial-gradient(green, yellow)'],
        },
      },
    };
    const vars = buildCssVarMap(manifest);
    expect(vars['--theme-body-background']).toBe(
      'linear-gradient(red, blue), radial-gradient(green, yellow)'
    );
  });
});

describe('renderCssVarRule', () => {
  it('formats a CSS rule with one declaration per line', () => {
    const rule = renderCssVarRule(':root', { '--a': '1', '--b': 'red' });
    expect(rule).toBe(':root {\n  --a: 1;\n  --b: red;\n}');
  });

  it('works with attribute selectors', () => {
    const rule = renderCssVarRule(':root[data-site-theme="x"]', { '--a': '1' });
    expect(rule).toContain(':root[data-site-theme="x"]');
  });
});
