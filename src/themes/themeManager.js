import { resolveThemeManifest } from './themeLoader.js';

const toKebab = (value = '') =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();

const withPx = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
};

const setVar = (vars, name, value) => {
  if (value === undefined || value === null || value === '') return;
  vars[name] = String(value);
};

const assignPrefixed = (vars, entries = {}, prefix) => {
  Object.entries(entries).forEach(([key, value]) => {
    setVar(vars, `${prefix}${key}`, value);
  });
};

function setSurfaceVars(vars, prefix, surface = {}) {
  if (!surface) return;
  setVar(vars, `${prefix}-bg`, surface.background);
  setVar(vars, `${prefix}-before`, surface.before);
  setVar(vars, `${prefix}-after`, surface.after);
}

function coerceSurface(value, defaults = {}) {
  if (value && typeof value === 'object') return value;
  if (!value) return defaults;
  return { ...defaults, background: value };
}

function coerceArray(value) {
  if (!value) return undefined;
  return Array.isArray(value) ? value.filter(Boolean).join(', ') : value;
}

function buildCssVarMap(manifest) {
  if (!manifest) return {};
  const vars = {};
  const tokens = manifest.tokens || {};
  const palette = tokens.palette || {};
  const text = tokens.text || {};
  const surfaces = tokens.surfaces || {};
  const helper = surfaces.helper || {};
  const tabs = surfaces.tabs || {};
  const field = surfaces.field || {};
  const strip = surfaces.strip || {};
  const chrome = surfaces.chrome || {};
  const heroSurface = surfaces.backdropPrimary || {};
  const promoSurface = surfaces.backdropSecondary || {};
  const typography = tokens.typography || {};
  const ctas = tokens.ctas || {};
  const chips = tokens.chips || {};
  const focus = tokens.focus || {};
  const radii = tokens.radii || {};
  const elevation = tokens.elevation || {};
  const utility = tokens.utility || {};

  assignPrefixed(
    vars,
    Object.fromEntries(
      Object.entries(palette).map(([key, value]) => [`--brand-${toKebab(key)}`, value])
    )
  );

  setVar(vars, '--brand-accent-electric', palette.primary || palette.accent);
  setVar(vars, '--brand-accent-electric-soft', palette.accentSoft);
  setVar(vars, '--brand-accent-warm', palette.accent || palette.warning);

  setVar(vars, '--brand-fg-100', text.primary);
  setVar(vars, '--brand-fg-200', text.muted);
  setVar(vars, '--brand-fg-300', text.mutedStrong);
  setVar(vars, '--brand-fg-050', text.inverse);
  setVar(vars, '--brand-bg-900', surfaces.base);
  setVar(vars, '--brand-bg-800', surfaces.baseAlt);
  setVar(vars, '--brand-bg-700', surfaces.raised);
  setVar(vars, '--brand-bg-600', surfaces.sunken);

  Object.entries(radii).forEach(([key, value]) => {
    setVar(vars, `--brand-radius-${toKebab(key)}`, withPx(value));
  });
  setVar(vars, '--brand-card-radius', withPx(radii.lg || radii.md));
  setVar(vars, '--brand-button-radius', withPx(radii.md || radii.sm));

  setVar(vars, '--brand-shadow-glow', elevation.raised);
  setVar(vars, '--brand-shadow-glow-strong', elevation.overlay);
  setVar(vars, '--brand-card-shadow', elevation.raised);
  setVar(vars, '--brand-surface-card-shadow', elevation.raised);

  const cardTextColor = text.card || text.primary;
  setVar(vars, '--brand-card-soft', surfaces.card);
  setVar(vars, '--brand-surface-card-bg', surfaces.card);
  setVar(vars, '--brand-card-border', surfaces.border);
  setVar(vars, '--brand-surface-card-border', surfaces.border);
  setVar(vars, '--brand-card-text', cardTextColor);
  setVar(vars, '--brand-surface-helper-bg', helper.background || surfaces.callout);
  setVar(vars, '--brand-surface-helper-hover-bg', helper.hover || helper.background);
  setVar(vars, '--brand-icon-badge-bg', surfaces.chipAccent || surfaces.chip);
  setVar(vars, '--brand-icon-badge-color', palette.primary || text.primary);

  setVar(vars, '--brand-border-highlight', surfaces.border);
  setVar(vars, '--brand-border-glow', surfaces.border);

  setVar(vars, '--brand-status-success', palette.success);
  setVar(vars, '--brand-status-error', palette.critical);
  setVar(vars, '--brand-status-error-soft', palette.criticalSoft);

  setVar(vars, '--brand-input-bg', field.background || surfaces.input);
  setVar(vars, '--brand-input-border', field.border || utility.inputBorder);
  setVar(vars, '--brand-input-border-active', focus.ring);
  setVar(vars, '--brand-input-text', field.inputColor || utility.inputText || text.primary);
  setVar(
    vars,
    '--brand-input-placeholder',
    field.inputPlaceholder || utility.inputPlaceholder || text.muted
  );
  setVar(vars, '--brand-focus-ring', focus.ring);
  setVar(vars, '--brand-focus-glow', focus.shadowInset);

  setVar(vars, '--brand-modal-backdrop', surfaces.backdrop);
  setVar(vars, '--brand-modal-surface', utility.modalSurface);
  setVar(vars, '--brand-modal-border', utility.modalBorder);
  setVar(vars, '--brand-modal-shadow', utility.modalShadow);
  setVar(vars, '--brand-modal-radius', withPx(utility.modalRadius));

  setVar(vars, '--brand-chart-track', utility.chartTrack);
  setVar(vars, '--brand-chart-center-text', utility.chartCenterText);

  setVar(vars, '--brand-header-bg', chrome.background);
  setVar(vars, '--brand-header-text', chrome.text);
  setVar(vars, '--site-header-shadow', chrome.shadow);
  setVar(vars, '--site-header-shadow-compact', chrome.compactShadow);

  const primaryCta = ctas.primary || {};
  setVar(vars, '--brand-primary-cta-gradient', primaryCta.bg);
  setVar(vars, '--brand-primary-cta-text', primaryCta.text);
  setVar(vars, '--brand-primary-cta-border', primaryCta.border);
  setVar(vars, '--brand-primary-cta-shadow', primaryCta.shadow);
  setVar(vars, '--brand-primary-cta-hover-shadow', primaryCta.shadow);
  setVar(vars, '--brand-primary-cta-hover-translate', 'translateY(-1px)');
  setVar(vars, '--brand-cta-text', primaryCta.text);

  setVar(vars, '--helper-strip-bg', helper.background || surfaces.callout);
  setVar(vars, '--helper-strip-border', helper.border || surfaces.border);
  setVar(vars, '--helper-strip-color', helper.text || text.primary);
  setVar(vars, '--helper-strip-hover-bg', helper.hover || helper.background);
  setVar(vars, '--helper-strip-hover-color', helper.hoverColor || helper.text || text.primary);
  setVar(vars, '--helper-strip-link-hover', helper.linkHover || palette.primary);
  setVar(vars, '--helper-strip-heading-color', helper.heading || text.primary);
  setVar(vars, '--helper-strip-body-color', helper.body || text.mutedStrong || text.muted);

  setVar(vars, '--tabs-bg', tabs.background);
  setVar(vars, '--tabs-border', tabs.border || surfaces.border);
  setVar(vars, '--tabs-shadow', tabs.shadow || elevation.flat);
  setVar(vars, '--tab-color', tabs.tabColor || text.muted);
  setVar(vars, '--tab-active-bg', tabs.activeBackground || palette.primary);
  setVar(vars, '--tab-active-color', tabs.activeColor || palette.inverse || '#fff');
  setVar(vars, '--tab-active-shadow', tabs.activeShadow || elevation.raised);
  setVar(vars, '--tab-step-bg', tabs.stepBackground || helper.background);
  setVar(vars, '--tab-step-border', tabs.stepBorder || helper.border);
  setVar(vars, '--tab-step-color', tabs.stepColor || palette.primary);
  setVar(vars, '--tab-active-step-bg', tabs.activeStepBackground || palette.primary);
  setVar(vars, '--tab-active-step-border', tabs.activeStepBorder || tabs.stepBorder);
  setVar(vars, '--tab-active-step-color', tabs.activeStepColor || palette.inverse || '#fff');

  setVar(vars, '--field-bg', field.background);
  setVar(vars, '--field-border', field.border || utility.inputBorder);
  setVar(vars, '--field-shadow', field.shadow || elevation.flat);
  setVar(vars, '--field-addon-bg', field.addonBackground || helper.background);
  setVar(vars, '--field-addon-border', field.addonBorder || helper.border);
  setVar(vars, '--field-addon-color', field.addonColor || helper.text || text.primary);
  setVar(vars, '--field-input-color', field.inputColor || text.primary);
  setVar(vars, '--field-input-placeholder', field.inputPlaceholder || text.muted);

  setVar(vars, '--community-strip-bg', strip.background || surfaces.card);
  setVar(vars, '--community-strip-border', strip.border || surfaces.border);
  setVar(vars, '--community-strip-color', strip.text || text.primary);

  setVar(vars, '--ui-text-primary', text.primary);
  setVar(vars, '--ui-text-muted', text.muted);
  setVar(vars, '--ui-field-label', text.muted);
  setVar(vars, '--ui-field-value', text.primary);
  setVar(vars, '--ui-status-heading-color', text.accent || palette.primary);

  setVar(vars, '--brand-countdown-digit', palette.primary);
  setVar(vars, '--brand-countdown-label', text.muted);

  const secondaryCta = ctas.secondary || {};
  setVar(vars, '--brand-pill-gradient', primaryCta.bg);
  setVar(vars, '--brand-pill-alt-gradient', secondaryCta.bg || primaryCta.bg);
  setVar(vars, '--brand-pill-contrast', primaryCta.text);

  setVar(vars, '--brand-chip-neutral-bg', chips.neutral?.bg);
  setVar(vars, '--brand-chip-neutral-color', chips.neutral?.text);
  setVar(vars, '--brand-chip-neutral-border', chips.neutral?.border);

  const heroBg = coerceArray(utility.gradientHero || heroSurface.background);
  const promoBg = coerceArray(utility.gradientPromo || promoSurface.background);
  if (heroBg) setVar(vars, '--brand-gradient-hero', heroBg);
  if (promoBg) setVar(vars, '--brand-gradient-promo', promoBg);

  setSurfaceVars(vars, '--hero-surface', heroSurface);
  setSurfaceVars(vars, '--promo-surface', promoSurface);
  const bodyBackground = coerceArray(utility.bodyBackground);
  if (bodyBackground) {
    setVar(vars, '--theme-body-background', bodyBackground);
  }

  const statusHeadline = coerceSurface(utility.statusHeadline, {
    color: palette.primary || text.primary,
    shadow: elevation.raised,
  });

  setVar(vars, '--status-headline-bg', statusHeadline.background);
  setVar(vars, '--status-headline-color', statusHeadline.color);
  setVar(vars, '--status-headline-shadow', statusHeadline.shadow);

  setVar(vars, '--status-price-value-color', palette.accent || palette.primary || text.primary);
  setVar(vars, '--status-price-value-shadow', elevation.raised);

  return vars;
}

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
