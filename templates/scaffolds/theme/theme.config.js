// __DISPLAY_NAME__ theme manifest. Defines the design tokens the CMS turns
// into `--brand-*`, `--theme-*`, and `--ui-*` CSS variables under
// `:root[data-site-theme="__SLUG__"]`. CMS components consume these via
// `var(--brand-*)`, so editing the values here cascades automatically.
//
// All token blocks below are required by the validator. The default palette
// is intentionally bland (cool slate + warm sand accent) so it's obvious
// what to change first. See @koehler8/cms-theme-neon, -frog, -aurora,
// -southpark, -swamp for production-quality references.

const slate900 = '#0f172a';
const slate800 = '#1e293b';
const slate700 = '#334155';
const slate200 = '#e2e8f0';
const slate100 = '#f1f5f9';
const sand = '#f4a261';
const sandDeep = '#d97e3a';
const ink = '#0b1220';
const cream = '#f7f3ec';

export default {
  slug: '__SLUG__',
  meta: {
    name: '__DISPLAY_NAME__',
    version: '0.1.0',
  },
  tokens: {
    palette: {
      primary: slate800,
      primaryAccent: slate900,
      secondary: slate700,
      accent: sand,
      accentSoft: 'rgba(244, 162, 97, 0.18)',
      neutral: ink,
      neutralStrong: cream,
      neutralSoft: slate200,
      inverse: '#ffffff',
      success: '#2a9d8f',
      info: slate700,
      warning: sand,
      critical: '#d62828',
      criticalSoft: 'rgba(214, 40, 40, 0.18)',
    },
    text: {
      primary: cream,
      muted: slate200,
      mutedStrong: slate100,
      inverse: ink,
      accent: sand,
      onAccent: '#ffffff',
    },
    surfaces: {
      base: ink,
      baseAlt: slate900,
      raised: slate800,
      sunken: '#070b14',
      callout: 'rgba(244, 162, 97, 0.12)',
      card: 'rgba(30, 41, 59, 0.92)',
      cardAlt: 'rgba(51, 65, 85, 0.92)',
      overlay: 'rgba(11, 18, 32, 0.96)',
      backdrop: 'rgba(11, 18, 32, 0.78)',
      border: 'rgba(226, 232, 240, 0.18)',
      divider: 'rgba(226, 232, 240, 0.12)',
      input: 'rgba(30, 41, 59, 0.96)',
      chip: 'rgba(244, 162, 97, 0.22)',
      chipAccent: sand,
      helper: {
        background: 'rgba(226, 232, 240, 0.08)',
        hover: 'rgba(226, 232, 240, 0.16)',
        text: cream,
        border: 'rgba(226, 232, 240, 0.2)',
        heading: cream,
        body: 'rgba(247, 243, 236, 0.85)',
      },
      tabs: {
        background: 'rgba(30, 41, 59, 0.92)',
        border: 'rgba(226, 232, 240, 0.16)',
        shadow: '0 18px 34px rgba(11, 18, 32, 0.45)',
        tabColor: 'rgba(247, 243, 236, 0.88)',
        activeBackground: 'rgba(244, 162, 97, 0.18)',
        activeColor: '#ffffff',
        activeShadow: '0 18px 40px rgba(11, 18, 32, 0.55), inset 0 1px 0 rgba(255,255,255,0.16)',
        stepBackground: 'rgba(255, 255, 255, 0.06)',
        stepBorder: 'rgba(255, 255, 255, 0.18)',
        stepColor: 'rgba(255, 255, 255, 0.72)',
        activeStepBackground: 'rgba(244, 162, 97, 0.24)',
        activeStepBorder: 'rgba(244, 162, 97, 0.5)',
        activeStepColor: sand,
      },
      field: {
        background: 'rgba(30, 41, 59, 0.96)',
        border: 'rgba(226, 232, 240, 0.16)',
        shadow: '0 8px 24px rgba(11, 18, 32, 0.32)',
        addonBackground: 'rgba(11, 18, 32, 0.92)',
        addonBorder: 'rgba(226, 232, 240, 0.16)',
        addonColor: cream,
        inputColor: cream,
        inputPlaceholder: 'rgba(241, 245, 249, 0.55)',
      },
      strip: {
        background: 'rgba(11, 18, 32, 0.9)',
        border: 'rgba(226, 232, 240, 0.16)',
        text: cream,
      },
      chrome: {
        background: 'rgba(11, 18, 32, 0.94)',
        text: cream,
        shadow: '0 18px 45px rgba(2, 5, 12, 0.55)',
        compactShadow: '0 12px 32px rgba(2, 5, 12, 0.65)',
      },
      backdropPrimary: {
        background: 'linear-gradient(150deg, rgba(11,18,32,0.98), rgba(15,23,42,0.92))',
        before: 'radial-gradient(circle, rgba(226,232,240,0.3), rgba(0,0,0,0))',
        after: 'radial-gradient(circle, rgba(244,162,97,0.5), rgba(0,0,0,0))',
      },
      backdropSecondary: {
        background: 'linear-gradient(140deg, rgba(11,18,32,0.97), rgba(15,23,42,0.92))',
        before: 'radial-gradient(circle, rgba(244,162,97,0.45), rgba(0,0,0,0))',
        after: 'radial-gradient(circle, rgba(226,232,240,0.4), rgba(0,0,0,0))',
      },
    },
    typography: {
      bodyFamily: '"Inter", "Helvetica Neue", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      headingFamily: '"Inter", "Helvetica Neue", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      monoFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      baseSize: '16px',
      scale: 1.125,
      weightRegular: 400,
      weightMedium: 500,
      weightBold: 600,
      letterSpacingTight: '-0.015em',
      letterSpacingWide: '0.08em',
    },
    ctas: {
      primary: {
        bg: `linear-gradient(135deg, ${sand} 0%, ${sandDeep} 100%)`,
        text: '#ffffff',
        border: '1px solid rgba(255,255,255,0.18)',
        hoverBg: `linear-gradient(135deg, ${sandDeep} 0%, ${sand} 100%)`,
        hoverBorder: '1px solid rgba(255,255,255,0.24)',
        shadow: '0 18px 35px rgba(11, 18, 32, 0.45)',
      },
      secondary: {
        bg: 'rgba(30, 41, 59, 0.92)',
        text: cream,
        border: 'rgba(226, 232, 240, 0.2)',
        hoverBg: 'rgba(226, 232, 240, 0.08)',
        hoverBorder: 'rgba(226, 232, 240, 0.32)',
        shadow: '0 8px 24px rgba(11, 18, 32, 0.32)',
      },
      ghost: {
        bg: 'transparent',
        text: cream,
        border: 'rgba(226, 232, 240, 0.2)',
        hoverBg: 'rgba(226, 232, 240, 0.08)',
        hoverBorder: 'rgba(226, 232, 240, 0.32)',
        shadow: 'none',
      },
      link: {
        text: sand,
        hoverText: sandDeep,
        underline: 'rgba(244, 162, 97, 0.45)',
      },
    },
    chips: {
      neutral: {
        bg: 'rgba(226, 232, 240, 0.12)',
        text: cream,
        border: 'rgba(226, 232, 240, 0.2)',
      },
      accent: {
        bg: 'rgba(244, 162, 97, 0.22)',
        text: '#ffffff',
        border: 'rgba(244, 162, 97, 0.45)',
      },
      outline: {
        bg: 'transparent',
        text: sand,
        border: 'rgba(244, 162, 97, 0.45)',
      },
    },
    focus: {
      ring: '0 0 0 2px rgba(226, 232, 240, 0.45)',
      ringMuted: '0 0 0 1px rgba(226, 232, 240, 0.32)',
      outline: 'rgba(226, 232, 240, 0.65)',
      shadowInset: '0 0 22px rgba(226, 232, 240, 0.32)',
    },
    radii: {
      sm: '6px',
      md: '12px',
      lg: '20px',
      pill: '999px',
      full: '50%',
    },
    elevation: {
      flat: '0 8px 24px rgba(11, 18, 32, 0.18)',
      raised: '0 18px 38px rgba(11, 18, 32, 0.32)',
      overlay: '0 24px 56px rgba(11, 18, 32, 0.5)',
    },
    utility: {
      divider: 'rgba(226, 232, 240, 0.16)',
      inputBorder: 'rgba(226, 232, 240, 0.16)',
      inputText: cream,
      inputPlaceholder: 'rgba(241, 245, 249, 0.55)',
      selectionBg: 'rgba(244, 162, 97, 0.32)',
      selectionText: '#ffffff',
      gradientHero: 'linear-gradient(150deg, rgba(11,18,32,0.98), rgba(15,23,42,0.92))',
      gradientPromo: 'linear-gradient(140deg, rgba(11,18,32,0.97), rgba(15,23,42,0.92))',
      bodyBackground: [
        'linear-gradient(155deg, rgba(11,18,32,0.98), rgba(15,23,42,0.92))',
      ],
      modalSurface: 'rgba(30, 41, 59, 0.96)',
      modalBorder: 'rgba(226, 232, 240, 0.16)',
      modalShadow: '0 24px 56px rgba(11, 18, 32, 0.5)',
      modalRadius: '20px',
      chartTrack: 'rgba(30, 41, 59, 0.85)',
      chartCenterText: cream,
      statusHeadline: {
        background: 'linear-gradient(120deg, rgba(226,232,240,0.12), rgba(244,162,97,0.18))',
        color: sand,
        shadow: '0 12px 24px rgba(11, 18, 32, 0.32), inset 0 1px 0 rgba(255,255,255,0.18)',
      },
    },
  },
  assets: {
    css: './theme.css',
  },
};
