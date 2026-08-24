import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registerInitialStateTrim,
  applyInitialStateTrims,
  clearInitialStateTrims,
  initialStateTrimCount,
} from '../../src/utils/initialStateTrim.js';

const CONFIG = () => ({
  site: { title: 'X' },
  shared: { content: { items: [{ slug: 'a', body: ['one'] }, { slug: 'b', body: ['two'] }] } },
  pages: { home: { path: '/' } },
});

const CTX = { routePath: '/a', locale: 'th', pageId: 'home', route: { path: '/a' } };

beforeEach(() => clearInitialStateTrims());

describe('applyInitialStateTrims', () => {
  it('returns the input BY REFERENCE when no hook is registered', () => {
    const config = CONFIG();
    expect(initialStateTrimCount()).toBe(0);
    expect(applyInitialStateTrims(config, CTX)).toBe(config);
    expect(config.sharedPartial).toBeUndefined();
  });

  it('stamps sharedPartial only when a hook actually changed something', () => {
    registerInitialStateTrim((c) => ({ ...c, shared: { content: {} } }));
    const config = CONFIG();
    const out = applyInitialStateTrims(config, CTX);
    expect(out.sharedPartial).toBe(true);
    // and does not mutate the source
    expect(config.sharedPartial).toBeUndefined();
    expect(config.shared.content.items).toHaveLength(2);
  });

  it('treats a hook returning the same reference as an explicit no-op', () => {
    registerInitialStateTrim((c) => c);
    const config = CONFIG();
    const out = applyInitialStateTrims(config, CTX);
    expect(out).toBe(config);
    expect(out.sharedPartial).toBeUndefined();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['a number', 42],
    ['an array', [1, 2]],
  ])('ignores a hook returning %s', (_label, value) => {
    registerInitialStateTrim(() => value);
    const config = CONFIG();
    const out = applyInitialStateTrims(config, CTX);
    expect(out).toBe(config);
    expect(out.sharedPartial).toBeUndefined();
  });

  it.each(['site', 'shared', 'pages'])(
    'discards a return that drops config.%s wholesale',
    (key) => {
      registerInitialStateTrim((c) => {
        const next = { ...c };
        delete next[key];
        return next;
      });
      const config = CONFIG();
      const out = applyInitialStateTrims(config, CTX);
      // Blast-radius guard: framework components on pages the hook never sees
      // read these directly, so losing one is a hydration mismatch on chrome.
      expect(out).toBe(config);
      expect(out[key]).toBeDefined();
    },
  );

  it('skips a throwing hook, warns, and still runs the later ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerInitialStateTrim(() => { throw new Error('boom'); });
    registerInitialStateTrim((c) => ({ ...c, marked: true }));
    const out = applyInitialStateTrims(CONFIG(), CTX);
    expect(out.marked).toBe(true);
    expect(out.sharedPartial).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not stamp the marker when the only hook throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerInitialStateTrim(() => { throw new Error('boom'); });
    const config = CONFIG();
    expect(applyInitialStateTrims(config, CTX)).toBe(config);
    expect(config.sharedPartial).toBeUndefined();
    warn.mockRestore();
  });

  it('composes hooks in registration order, each seeing the previous output', () => {
    const seen = [];
    registerInitialStateTrim((c) => { seen.push(c.step ?? 0); return { ...c, step: 1 }; });
    registerInitialStateTrim((c) => { seen.push(c.step ?? 0); return { ...c, step: 2 }; });
    const out = applyInitialStateTrims(CONFIG(), CTX);
    expect(seen).toEqual([0, 1]);
    expect(out.step).toBe(2);
  });

  it('passes the route context through verbatim', () => {
    let received = null;
    registerInitialStateTrim((c, ctx) => { received = ctx; return c; });
    applyInitialStateTrims(CONFIG(), CTX);
    expect(received).toEqual(CTX);
  });

  it('ignores a non-function registration', () => {
    registerInitialStateTrim(null);
    registerInitialStateTrim('nope');
    expect(initialStateTrimCount()).toBe(0);
  });

  it('leaves a non-object config alone', () => {
    registerInitialStateTrim((c) => ({ ...c, marked: true }));
    expect(applyInitialStateTrims(null, CTX)).toBe(null);
    expect(applyInitialStateTrims('x', CTX)).toBe('x');
  });
});
