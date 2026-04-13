import { describe, it, expect, beforeEach } from 'vitest';
// We can't easily test applyThemeVariables without the full themeLoader module init,
// so we test the CSS var map building logic by importing the module and calling
// applyThemeVariables which internally calls buildCssVarMap.
// Instead, we'll test the exported function with a mock themeLoader.

// Since buildCssVarMap is not exported, we test through applyThemeVariables indirectly
// by checking what CSS vars get injected into the document.
import baseManifest from '../../themes/base/theme.config.js';

describe('themeManager (via applyThemeVariables)', () => {
  beforeEach(() => {
    // Clean up any theme-vars style tags
    const existing = document.getElementById('theme-vars');
    if (existing) existing.remove();
  });

  it('can be imported without errors', async () => {
    // The module imports themeLoader which uses import.meta.glob
    // In test environment this may not work, so we test what we can
    const mod = await import('../../src/themes/themeManager.js');
    expect(typeof mod.applyThemeVariables).toBe('function');
  });

  it('applyThemeVariables injects a style tag', async () => {
    const { applyThemeVariables } = await import('../../src/themes/themeManager.js');
    // Will use base theme as fallback
    const manifest = applyThemeVariables('base');
    expect(manifest).toBeDefined();
    const styleTag = document.getElementById('theme-vars');
    expect(styleTag).not.toBeNull();
    expect(styleTag.textContent).toContain(':root');
    expect(styleTag.textContent).toContain('--brand-');
  });

  it('replaces existing style tag on re-apply', async () => {
    const { applyThemeVariables } = await import('../../src/themes/themeManager.js');
    applyThemeVariables('base');
    const first = document.getElementById('theme-vars').textContent;
    applyThemeVariables('base');
    const second = document.getElementById('theme-vars').textContent;
    // Should replace, not duplicate
    expect(document.querySelectorAll('#theme-vars').length).toBe(1);
    expect(second).toBe(first);
  });
});
