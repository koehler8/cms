import { describe, it, expect } from 'vitest';
import {
  getExtensionComponent,
  getExtensionComponentDefinition,
  getExtensionContentDefaults,
  extensionComponentsCatalog,
  registeredExtensionComponents,
  extensionComponentDefinitions,
  extensionComponentSources,
} from '../../src/extensions/extensionLoader.js';

describe('extensionLoader', () => {
  describe('getExtensionComponent', () => {
    it('returns null for unknown component name', () => {
      expect(getExtensionComponent('NonExistent')).toBeNull();
    });

    it('returns null for empty/falsy name', () => {
      expect(getExtensionComponent('')).toBeNull();
      expect(getExtensionComponent(null)).toBeNull();
    });
  });

  describe('getExtensionComponentDefinition', () => {
    it('returns null for unknown component name', () => {
      expect(getExtensionComponentDefinition('NonExistent')).toBeNull();
    });
  });

  describe('getExtensionContentDefaults', () => {
    it('returns undefined when slug is missing', () => {
      expect(getExtensionContentDefaults('', 'key')).toBeUndefined();
    });

    it('returns undefined when configKey is missing', () => {
      expect(getExtensionContentDefaults('slug', '')).toBeUndefined();
    });

    it('returns undefined for unknown slug', () => {
      expect(getExtensionContentDefaults('unknown-slug', 'someKey')).toBeUndefined();
    });
  });

  describe('extensionComponentsCatalog', () => {
    it('is an array', () => {
      expect(Array.isArray(extensionComponentsCatalog)).toBe(true);
    });
  });

  describe('registeredExtensionComponents proxy', () => {
    it('returns null for unknown component via proxy', () => {
      expect(registeredExtensionComponents['NonExistent']).toBeNull();
    });
  });

  describe('extensionComponentSources proxy', () => {
    it('returns undefined for unknown component', () => {
      expect(extensionComponentSources['NonExistent']).toBeUndefined();
    });
  });
});
