import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRegistry,
  setSiteComponents,
  getSiteComponent,
  getSiteRegistry,
} from '../../src/utils/componentRegistry.js';

const MockComponent = { name: 'MockComponent', render() {} };
const MockComponent2 = { name: 'MockComponent2', render() {} };

describe('createRegistry', () => {
  it('registers components from glob modules', () => {
    const modules = {
      '../components/Hero.vue': { default: MockComponent },
    };
    const registry = createRegistry(modules);
    expect(registry.Hero).toBe(MockComponent);
  });

  it('derives component name from file path', () => {
    const modules = {
      '../components/ui/SbCard.vue': { default: MockComponent },
    };
    const registry = createRegistry(modules);
    expect(registry.SbCard).toBe(MockComponent);
  });

  it('first registration wins for duplicate names', () => {
    const modules = {
      '../components/Hero.vue': { default: MockComponent },
      '../components/legacy/Hero.vue': { default: MockComponent2 },
    };
    const registry = createRegistry(modules);
    expect(registry.Hero).toBe(MockComponent);
  });

  it('unwraps module.default', () => {
    const modules = {
      '../components/Footer.vue': { default: MockComponent },
    };
    const registry = createRegistry(modules);
    expect(registry.Footer).toBe(MockComponent);
  });

  it('handles modules without default export', () => {
    const modules = {
      '../components/Direct.vue': MockComponent,
    };
    const registry = createRegistry(modules);
    expect(registry.Direct).toBe(MockComponent);
  });

  it('creates Spacer fallback from lowest numbered Spacer', () => {
    const Spacer15 = { name: 'Spacer15' };
    const Spacer30 = { name: 'Spacer30' };
    const Spacer60 = { name: 'Spacer60' };
    const modules = {
      '../components/Spacer60.vue': { default: Spacer60 },
      '../components/Spacer15.vue': { default: Spacer15 },
      '../components/Spacer30.vue': { default: Spacer30 },
    };
    const registry = createRegistry(modules);
    expect(registry.Spacer).toBe(Spacer15);
  });

  it('does not create Spacer fallback if Spacer already registered', () => {
    const ExplicitSpacer = { name: 'Spacer' };
    const Spacer15 = { name: 'Spacer15' };
    const modules = {
      '../components/Spacer.vue': { default: ExplicitSpacer },
      '../components/Spacer15.vue': { default: Spacer15 },
    };
    const registry = createRegistry(modules);
    expect(registry.Spacer).toBe(ExplicitSpacer);
  });

  it('returns empty registry for empty modules', () => {
    const registry = createRegistry({});
    expect(Object.keys(registry)).toEqual([]);
  });

  it('skips null/falsy module entries', () => {
    const modules = {
      '../components/Null.vue': null,
      '../components/Real.vue': { default: MockComponent },
    };
    const registry = createRegistry(modules);
    expect(registry.Null).toBeUndefined();
    expect(registry.Real).toBe(MockComponent);
  });
});

describe('setSiteComponents / getSiteComponent', () => {
  beforeEach(() => {
    // Reset between tests so leftover registrations don't leak.
    setSiteComponents({});
  });

  it('registers components keyed by basename', () => {
    setSiteComponents({
      './components/PropertyCard.vue': { default: MockComponent },
    });
    expect(getSiteComponent('PropertyCard')).toBe(MockComponent);
  });

  it('strips subdirectories — basename rules', () => {
    setSiteComponents({
      './components/regions/PacificCoast.vue': { default: MockComponent },
    });
    expect(getSiteComponent('PacificCoast')).toBe(MockComponent);
  });

  it('first registration wins on duplicate basenames', () => {
    setSiteComponents({
      './components/Card.vue': { default: MockComponent },
      './components/legacy/Card.vue': { default: MockComponent2 },
    });
    expect(getSiteComponent('Card')).toBe(MockComponent);
  });

  it('unwraps module.default', () => {
    setSiteComponents({
      './components/Foo.vue': { default: MockComponent },
    });
    expect(getSiteComponent('Foo')).toBe(MockComponent);
  });

  it('accepts modules where the default export is the component itself', () => {
    setSiteComponents({
      './components/Bar.vue': MockComponent,
    });
    expect(getSiteComponent('Bar')).toBe(MockComponent);
  });

  it('returns undefined for unknown names', () => {
    expect(getSiteComponent('Nope')).toBeUndefined();
  });

  it('clears prior registrations when called again (HMR-friendly)', () => {
    setSiteComponents({
      './components/Old.vue': { default: MockComponent },
    });
    expect(getSiteComponent('Old')).toBe(MockComponent);

    setSiteComponents({
      './components/New.vue': { default: MockComponent2 },
    });
    expect(getSiteComponent('Old')).toBeUndefined();
    expect(getSiteComponent('New')).toBe(MockComponent2);
  });

  it('tolerates null/missing modules gracefully', () => {
    setSiteComponents(null);
    expect(getSiteComponent('Anything')).toBeUndefined();
    setSiteComponents();
    expect(getSiteComponent('Anything')).toBeUndefined();
  });

  it('snapshot via getSiteRegistry returns a copy', () => {
    setSiteComponents({
      './components/Foo.vue': { default: MockComponent },
    });
    const snap = getSiteRegistry();
    expect(snap.Foo).toBe(MockComponent);
    snap.Foo = null;
    // Mutating the snapshot must not affect the live registry.
    expect(getSiteComponent('Foo')).toBe(MockComponent);
  });

  it('accepts a glob result wrapped in `default` (the entry imports as namespace)', () => {
    // The generated entry does `import * as __cmsSiteComponents from VIRTUAL`
    // and the virtual module exports `default`. Check we accept both shapes.
    setSiteComponents({
      default: { './components/Foo.vue': { default: MockComponent } },
    });
    expect(getSiteComponent('Foo')).toBe(MockComponent);
  });
});
