const COLOR_PATTERN =
  /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\(|hsla?\(|var\(--|linear-gradient\(|radial-gradient\(|conic-gradient\(|color-mix\()/i;
const CSS_UNIT_PATTERN = /^-?\d*\.?\d+(px|rem|em|vh|vw|%)$/i;

const CTA_KEYS = ['bg', 'text', 'border', 'hoverBg', 'hoverBorder', 'shadow'];
const CHIP_KEYS = ['bg', 'text', 'border'];

const REQUIRED_BLOCKS = {
  palette: [
    'primary',
    'primaryAccent',
    'secondary',
    'accent',
    'accentSoft',
    'neutral',
    'neutralStrong',
    'inverse',
    'success',
    'info',
    'warning',
    'critical',
  ],
  text: ['primary', 'muted', 'mutedStrong', 'inverse', 'accent', 'onAccent'],
  surfaces: [
    'base',
    'baseAlt',
    'raised',
    'sunken',
    'callout',
    'card',
    'cardAlt',
    'overlay',
    'backdrop',
    'border',
    'divider',
    'input',
    'chip',
    'chipAccent',
  ],
  typography: [
    'bodyFamily',
    'headingFamily',
    'monoFamily',
    'baseSize',
    'scale',
    'weightRegular',
    'weightMedium',
    'weightBold',
    'letterSpacingTight',
    'letterSpacingWide',
  ],
  ctas: ['primary', 'secondary', 'ghost', 'link'],
  chips: ['neutral', 'accent', 'outline'],
  focus: ['ring', 'ringMuted', 'outline', 'shadowInset'],
  radii: ['sm', 'md', 'lg', 'pill', 'full'],
  elevation: ['flat', 'raised', 'overlay'],
  utility: [
    'divider',
    'inputBorder',
    'inputText',
    'inputPlaceholder',
    'selectionBg',
    'selectionText',
    'gradientHero',
    'gradientPromo',
    'bodyBackground',
    'modalSurface',
    'modalBorder',
    'modalShadow',
    'modalRadius',
    'chartTrack',
    'chartCenterText',
    'statusHeadline',
  ],
};

const NESTED_SURFACES = {
  helper: ['background', 'hover', 'text', 'border', 'heading', 'body'],
  tabs: [
    'background',
    'border',
    'shadow',
    'tabColor',
    'activeBackground',
    'activeColor',
    'activeShadow',
    'stepBackground',
    'stepBorder',
    'stepColor',
    'activeStepBackground',
    'activeStepBorder',
    'activeStepColor',
  ],
  field: [
    'background',
    'border',
    'shadow',
    'addonBackground',
    'addonBorder',
    'addonColor',
    'inputColor',
    'inputPlaceholder',
  ],
  strip: ['background', 'border', 'text'],
  chrome: ['background', 'text', 'shadow', 'compactShadow'],
  backdropPrimary: ['background', 'before', 'after'],
  backdropSecondary: ['background', 'before', 'after'],
};

const CTA_OVERRIDES = {
  primary: { border: ensureString, hoverBorder: ensureString, shadow: ensureString },
  secondary: { border: ensureString, hoverBorder: ensureString, shadow: ensureString },
  ghost: { border: ensureString, hoverBorder: ensureString, shadow: ensureString },
  link: { underline: ensureColor },
};

const CHIP_OVERRIDES = {
  outline: { border: ensureString },
};

const SURFACE_NESTED_OVERRIDES = {
  tabs: {
    border: ensureString,
    shadow: ensureString,
    activeShadow: ensureString,
    stepBorder: ensureString,
    activeStepBorder: ensureString,
  },
  field: {
    shadow: ensureString,
    addonBorder: ensureString,
  },
  chrome: {
    shadow: ensureString,
    compactShadow: ensureString,
  },
};

const UTILITY_VALIDATORS = {
  divider: ensureColor,
  inputBorder: ensureColor,
  inputText: ensureColor,
  inputPlaceholder: ensureColor,
  selectionBg: ensureColor,
  selectionText: ensureColor,
  gradientHero: ensureColor,
  gradientPromo: ensureColor,
  bodyBackground: ensureColor,
  modalSurface: ensureColor,
  modalBorder: ensureColor,
  modalShadow: ensureString,
  modalRadius: (value, path, errors) => {
    if (!isCssSize(value)) errors.push(`${path} must be a CSS size`);
  },
  chartTrack: ensureColor,
  chartCenterText: ensureColor,
  statusHeadline: ensureSurfaceOrColor,
};

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isColor(value) {
  if (!isString(value)) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'transparent' || normalized === 'currentcolor' || normalized === 'none') {
    return true;
  }
  return COLOR_PATTERN.test(normalized);
}

function isCssSize(value) {
  if (typeof value === 'number') return true;
  if (!isString(value)) return false;
  const normalized = value.trim();
  if (normalized === '0') return true;
  return CSS_UNIT_PATTERN.test(normalized);
}

function ensureColor(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => ensureColor(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isColor(value)) {
    errors.push(`${path} must be a CSS color/gradient value`);
  }
}

function ensureSurfaceOrColor(value, path, errors) {
  if (value && typeof value === 'object') {
    if (!value.background) {
      errors.push(`${path}.background is required`);
    } else {
      ensureColor(value.background, `${path}.background`, errors);
    }
    if (value.color) ensureColor(value.color, `${path}.color`, errors);
    if (value.shadow) ensureString(value.shadow, `${path}.shadow`, errors);
    if (value.border) ensureColor(value.border, `${path}.border`, errors);
    if (value.valueColor) ensureColor(value.valueColor, `${path}.valueColor`, errors);
    if (value.valueShadow) ensureString(value.valueShadow, `${path}.valueShadow`, errors);
    return;
  }
  ensureColor(value, path, errors);
}

function ensureString(value, path, errors) {
  if (!isString(value)) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function ensureObject(value, path, errors) {
  if (!value || typeof value !== 'object') {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function ensureKeys(obj, keys, path, errors, validator = ensureColor, overrides = {}) {
  keys.forEach((key) => {
    if (!(key in obj)) {
      errors.push(`${path}.${key} is required`);
      return;
    }
    const fieldValidator = overrides[key] || validator;
    fieldValidator(obj[key], `${path}.${key}`, errors);
  });
}

function validatePaletteBlock(tokens, errors) {
  if (!ensureObject(tokens.palette, 'tokens.palette', errors)) return;
  ensureKeys(tokens.palette, REQUIRED_BLOCKS.palette, 'tokens.palette', errors, ensureColor);
}

function validateTextBlock(tokens, errors) {
  if (!ensureObject(tokens.text, 'tokens.text', errors)) return;
  ensureKeys(tokens.text, REQUIRED_BLOCKS.text, 'tokens.text', errors, ensureColor);
}

function validateSurfaceBlock(tokens, errors) {
  if (!ensureObject(tokens.surfaces, 'tokens.surfaces', errors)) return;
  ensureKeys(tokens.surfaces, REQUIRED_BLOCKS.surfaces, 'tokens.surfaces', errors, ensureColor);
  Object.entries(NESTED_SURFACES).forEach(([key, nestedKeys]) => {
    const node = tokens.surfaces[key];
    if (!ensureObject(node, `tokens.surfaces.${key}`, errors)) return;
    ensureKeys(
      node,
      nestedKeys,
      `tokens.surfaces.${key}`,
      errors,
      ensureColor,
      SURFACE_NESTED_OVERRIDES[key] || {}
    );
  });
}

function validateTypography(tokens, errors) {
  if (!ensureObject(tokens.typography, 'tokens.typography', errors)) return;
  ensureKeys(tokens.typography, REQUIRED_BLOCKS.typography, 'tokens.typography', errors, (value, path) => {
    if (typeof value === 'number') return;
    if (!isString(value)) {
      errors.push(`${path} must be a string or number`);
    }
  });
}

function validateCtas(tokens, errors) {
  if (!ensureObject(tokens.ctas, 'tokens.ctas', errors)) return;
  REQUIRED_BLOCKS.ctas.forEach((ctaKey) => {
    const block = tokens.ctas[ctaKey];
    if (!ensureObject(block, `tokens.ctas.${ctaKey}`, errors)) return;
    const keys = ctaKey === 'link' ? ['text', 'hoverText', 'underline'] : CTA_KEYS;
    ensureKeys(
      block,
      keys,
      `tokens.ctas.${ctaKey}`,
      errors,
      ensureColor,
      CTA_OVERRIDES[ctaKey] || {}
    );
  });
}

function validateChips(tokens, errors) {
  if (!ensureObject(tokens.chips, 'tokens.chips', errors)) return;
  REQUIRED_BLOCKS.chips.forEach((chipKey) => {
    const block = tokens.chips[chipKey];
    if (!ensureObject(block, `tokens.chips.${chipKey}`, errors)) return;
    ensureKeys(
      block,
      CHIP_KEYS,
      `tokens.chips.${chipKey}`,
      errors,
      ensureColor,
      CHIP_OVERRIDES[chipKey] || {}
    );
  });
}

function validateFocus(tokens, errors) {
  if (!ensureObject(tokens.focus, 'tokens.focus', errors)) return;
  ensureKeys(tokens.focus, REQUIRED_BLOCKS.focus, 'tokens.focus', errors, ensureString);
}

function validateRadii(tokens, errors) {
  if (!ensureObject(tokens.radii, 'tokens.radii', errors)) return;
  ensureKeys(tokens.radii, REQUIRED_BLOCKS.radii, 'tokens.radii', errors, (value, path) => {
    if (!isCssSize(value)) {
      errors.push(`${path} must be a CSS size (px, rem, etc.)`);
    }
  });
}

function validateElevation(tokens, errors) {
  if (!ensureObject(tokens.elevation, 'tokens.elevation', errors)) return;
  ensureKeys(tokens.elevation, REQUIRED_BLOCKS.elevation, 'tokens.elevation', errors, ensureString);
}

function validateUtility(tokens, errors) {
  if (!ensureObject(tokens.utility, 'tokens.utility', errors)) return;
  REQUIRED_BLOCKS.utility.forEach((key) => {
    const value = tokens.utility[key];
    if (value === undefined || value === null || value === '') {
      errors.push(`tokens.utility.${key} is required`);
      return;
    }
    const validator = UTILITY_VALIDATORS[key] || ensureColor;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => validator(entry, `tokens.utility.${key}[${index}]`, errors));
      return;
    }
    validator(value, `tokens.utility.${key}`, errors);
  });
}

export function validateThemeManifest(manifest, options = {}) {
  const { throwOnError = true } = options;
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    errors.push('Theme manifest must be an object');
  } else {
    if (!isString(manifest.slug)) {
      errors.push('manifest.slug must be a non-empty string');
    }
    if (!ensureObject(manifest.meta, 'manifest.meta', errors)) {
      // no-op
    } else {
      if (!isString(manifest.meta.name)) errors.push('manifest.meta.name is required');
      if (!isString(manifest.meta.version)) errors.push('manifest.meta.version is required');
    }
    if (!ensureObject(manifest.tokens, 'manifest.tokens', errors)) {
      // no-op
    } else {
      validatePaletteBlock(manifest.tokens, errors);
      validateTextBlock(manifest.tokens, errors);
      validateSurfaceBlock(manifest.tokens, errors);
      validateTypography(manifest.tokens, errors);
      validateCtas(manifest.tokens, errors);
      validateChips(manifest.tokens, errors);
      validateFocus(manifest.tokens, errors);
      validateRadii(manifest.tokens, errors);
      validateElevation(manifest.tokens, errors);
      validateUtility(manifest.tokens, errors);
    }
  }

  if (errors.length && throwOnError) {
    const slug = manifest?.slug || 'unknown';
    const error = new Error(
      `Theme manifest "${slug}" is invalid:\n- ${errors.join('\n- ')}`
    );
    error.errors = errors;
    throw error;
  }

  return { valid: errors.length === 0, errors };
}
