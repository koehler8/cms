const DEFAULT_LOCALE = 'en-US';

const formatterCache = new Map();

function getFormatter(options) {
  const normalizedOptions = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a > b ? 1 : -1));
  const key = JSON.stringify(normalizedOptions);
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.NumberFormat(DEFAULT_LOCALE, Object.fromEntries(normalizedOptions)));
  }
  return formatterCache.get(key);
}

function coerceNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'bigint') return Number(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatDecimal(value, {
  minimumFractionDigits = 0,
  maximumFractionDigits = 2,
  compact = false,
  useGrouping = true,
  signDisplay,
} = {}) {
  const numeric = coerceNumber(value);
  const formatter = getFormatter({
    style: 'decimal',
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
    signDisplay,
  });
  return formatter.format(numeric);
}

export function formatCurrency(value, {
  currency = 'USD',
  minimumFractionDigits = 2,
  maximumFractionDigits = 2,
  compact = false,
  useGrouping = true,
} = {}) {
  const numeric = coerceNumber(value);
  const formatter = getFormatter({
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  });
  return formatter.format(numeric);
}

export function formatCompact(value, {
  maximumFractionDigits = 1,
  minimumFractionDigits,
  useGrouping = true,
} = {}) {
  const numeric = coerceNumber(value);
  const formatter = getFormatter({
    style: 'decimal',
    notation: 'compact',
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  });
  return formatter.format(numeric);
}

export function formatPercent(value, {
  maximumFractionDigits = 1,
  minimumFractionDigits = 0,
  assumeFraction = false,
  useGrouping = false,
} = {}) {
  const numericInput = coerceNumber(value);
  const scaled = assumeFraction ? numericInput : numericInput / 100;
  const formatter = getFormatter({
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  });
  return formatter.format(scaled);
}

export function formatTokenAmount(value, {
  minimumFractionDigits = 0,
  maximumFractionDigits = 2,
  compact = false,
} = {}) {
  return formatDecimal(value, {
    minimumFractionDigits,
    maximumFractionDigits,
    compact,
  });
}

export function formatUsd(value, options = {}) {
  return formatCurrency(value, { currency: 'USD', ...options });
}

export function formatWithFallback(value, fallback = '0', formatter = formatDecimal) {
  if (value === null || value === undefined) return fallback;
  const numeric = coerceNumber(value);
  if (!Number.isFinite(numeric)) return fallback;
  return formatter(numeric);
}
