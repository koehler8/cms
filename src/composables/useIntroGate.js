import { computed } from 'vue';

const ALLOWED_KEYS = [
  'eyebrow',
  'title',
  'body',
  'primaryLabel',
  'secondaryLabel',
  'secondaryHref',
  'storageKey',
  'closeAriaLabel',
];

export function useIntroGate({ siteData, pageContent }) {
  const introGateSettings = computed(() => {
    const result = {};
    const sources = [
      siteData.value?.shared?.content?.introGate,
      pageContent.value?.introGate,
    ];
    for (const src of sources) {
      if (!src || typeof src !== 'object') continue;
      for (const [key, value] of Object.entries(src)) {
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
    return result;
  });

  const introGateEnabled = computed(() => Boolean(introGateSettings.value.enabled));

  const introGateProps = computed(() => {
    const config = introGateSettings.value;
    if (!config || typeof config !== 'object') return {};
    return ALLOWED_KEYS.reduce((acc, key) => {
      if (config[key] !== undefined) {
        acc[key] = config[key];
      }
      return acc;
    }, {});
  });

  return { introGateEnabled, introGateProps };
}
