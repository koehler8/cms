function hasUsableValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function satisfiesSegments(target, segments) {
  if (!segments.length) {
    return hasUsableValue(target);
  }
  if (target === null || target === undefined) return false;

  const [rawSegment, ...rest] = segments;
  const isArraySegment = rawSegment.endsWith('[]');
  const key = isArraySegment ? rawSegment.slice(0, -2) : rawSegment;
  const nextValue = key ? target?.[key] : target;

  if (isArraySegment) {
    if (!Array.isArray(nextValue) || nextValue.length === 0) {
      return false;
    }
    if (!rest.length) {
      return nextValue.some((item) => hasUsableValue(item));
    }
    return nextValue.some((item) => satisfiesSegments(item, rest));
  }

  if (!rest.length) {
    return hasUsableValue(nextValue);
  }

  return satisfiesSegments(nextValue, rest);
}

export function validateRequiredContentPaths(content, requiredPaths = []) {
  if (!Array.isArray(requiredPaths) || requiredPaths.length === 0) {
    return { isValid: true, missing: [] };
  }
  const missing = [];

  for (const rawPath of requiredPaths) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      continue;
    }
    const segments = rawPath.split('.').map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) continue;
    const satisfied = satisfiesSegments(content, segments);
    if (!satisfied) {
      missing.push(rawPath);
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
  };
}
