const ARRAY_INDEX_RE = /\[(\d+)]/g;

function setNestedPath(root, dotPath, value) {
  const segments = dotPath.replace(ARRAY_INDEX_RE, '.$1').split('.');
  let current = root;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];
    const nextIsIndex = /^\d+$/.test(nextSeg);

    if (current[seg] === undefined || current[seg] === null) {
      current[seg] = nextIsIndex ? [] : {};
    }
    current = current[seg];
  }

  current[segments[segments.length - 1]] = value;
}

export function inflateFlatConfig(flat) {
  if (!flat || typeof flat !== 'object') return flat;

  const result = {};
  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith('$')) continue;
    setNestedPath(result, key, value);
  }
  return result;
}
