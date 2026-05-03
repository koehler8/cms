import { resolveThemeManifest } from './themeLoader.js';
import { buildCssVarMap } from './buildCssVarMap.js';

// buildCssVarMap was extracted to its own pure module so the build-time
// vite plugin can call it (to emit `virtual:cms-theme-vars.css`) without
// pulling in this file's runtime-only imports.

export function applyThemeVariables(themeKey) {
  const manifest = resolveThemeManifest(themeKey);
  if (typeof document === 'undefined') {
    return manifest;
  }
  const vars = buildCssVarMap(manifest);
  const root = document.documentElement;

  // Remove inline assignments from previous calls so normal cascade can apply.
  Object.keys(vars).forEach((name) => root.style.removeProperty(name));

  let styleTag = document.getElementById('theme-vars');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'theme-vars';
    // Insert early so site/theme overrides loaded later can win via cascade.
    const head = document.head || root;
    head.insertBefore(styleTag, head.firstChild);
  }

  const cssBody = Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n  ');
  styleTag.textContent = `:root {\n  ${cssBody}\n}`;

  return manifest;
}
