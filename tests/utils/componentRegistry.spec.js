import { describe, it, expect } from 'vitest';
import { createRegistry } from '../../src/utils/componentRegistry.js';

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
