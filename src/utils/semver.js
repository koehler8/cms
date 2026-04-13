function toParts(version) {
  if (!version || typeof version !== 'string') {
    return {
      parts: [0, 0, 0],
      prerelease: '',
    };
  }
  const trimmed = version.trim();
  const [core = '', prerelease = ''] = trimmed.split('-', 2);
  const parts = core
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  while (parts.length < 3) {
    parts.push(0);
  }
  return {
    parts: parts.slice(0, 3),
    prerelease: prerelease || '',
  };
}

export function compareVersions(aVersion = '', bVersion = '') {
  const a = toParts(aVersion);
  const b = toParts(bVersion);

  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] > b.parts[i]) return 1;
    if (a.parts[i] < b.parts[i]) return -1;
  }

  if (a.prerelease === b.prerelease) {
    return 0;
  }

  if (a.prerelease && !b.prerelease) {
    return -1;
  }
  if (!a.prerelease && b.prerelease) {
    return 1;
  }

  return a.prerelease.localeCompare(b.prerelease);
}

export function satisfiesMinVersion(current, required) {
  if (!required) return true;
  return compareVersions(current, required) >= 0;
}
