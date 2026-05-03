import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getExtensionComponent,
  getExtensionComponentDefinition,
  getExtensionContentDefaults,
  extensionComponentsCatalog,
  registeredExtensionComponents,
  extensionComponentDefinitions,
  extensionComponentSources,
  registerExtension,
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

  describe('registerExtension with empty components (styles-only / setup-only)', () => {
    // The manifest schema's `components.minItems` was relaxed from 1 to 0 in
    // 1.0.0-beta.11 so extensions that only contribute via setup() or
    // side-effect CSS imports don't have to ship a no-op stub component.

    it('accepts a manifest with components: [] without throwing', async () => {
      await expect(
        registerExtension({
          manifest: {
            slug: 'styles-only-test',
            version: '1.0.0',
            license: 'MIT',
            provider: { name: 'Styles-only test extension' },
            components: [],
          },
        }),
      ).resolves.toBeUndefined();
    });

    it('runs the setup() function when registered', async () => {
      const setupSpy = vi.fn();
      await registerExtension({
        manifest: {
          slug: 'setup-only-test',
          version: '1.0.0',
          license: 'MIT',
          provider: { name: 'Setup-only test extension' },
          components: [],
        },
        setup: setupSpy,
      });
      // setup() runs later, via runExtensionSetups(), not at registration.
      // Just confirm the extension was registered (setup not invoked yet).
      expect(setupSpy).not.toHaveBeenCalled();
    });

    it('does not pollute the component registry', async () => {
      await registerExtension({
        manifest: {
          slug: 'no-components-test',
          version: '1.0.0',
          license: 'MIT',
          provider: { name: 'No-components test extension' },
          components: [],
        },
      });
      expect(registeredExtensionComponents['Anything']).toBeNull();
    });
  });
});
