import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readManifest,
  writeManifest,
  configsEqual,
  MANIFEST_VERSION,
} from '../../../scripts/image-variants/manifest.js';

describe('readManifest / writeManifest', () => {
  let tmp;
  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-iv-mf-'));
  });
  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  it('returns null when manifest file does not exist', () => {
    expect(readManifest(path.join(tmp, '.manifest.json'))).toBeNull();
  });

  it('round-trips a manifest', () => {
    const p = path.join(tmp, '.manifest.json');
    const m = {
      version: MANIFEST_VERSION,
      config: { widths: [320], formats: ['webp'], quality: { webp: 75 } },
      sources: {
        'img/logo.png': { mtimeMs: 12345, variants: ['assets/img/logo-320.webp'] },
      },
    };
    writeManifest(p, m);
    const back = readManifest(p);
    expect(back).toEqual(m);
  });

  it('returns null on malformed JSON', () => {
    const p = path.join(tmp, '.manifest.json');
    fs.writeFileSync(p, '{ not json');
    expect(readManifest(p)).toBeNull();
  });

  it('returns null on version mismatch', () => {
    const p = path.join(tmp, '.manifest.json');
    fs.writeFileSync(p, JSON.stringify({ version: 99, sources: {} }));
    expect(readManifest(p)).toBeNull();
  });
});

describe('configsEqual', () => {
  const baseline = { widths: [320, 640], formats: ['webp', 'avif'], quality: { webp: 75, avif: 60 } };

  it('returns true for identical config objects', () => {
    expect(configsEqual(baseline, { ...baseline })).toBe(true);
  });

  it('is order-insensitive for arrays', () => {
    expect(configsEqual(baseline, { ...baseline, widths: [640, 320] })).toBe(true);
    expect(configsEqual(baseline, { ...baseline, formats: ['avif', 'webp'] })).toBe(true);
  });

  it('returns false when widths differ', () => {
    expect(configsEqual(baseline, { ...baseline, widths: [320] })).toBe(false);
    expect(configsEqual(baseline, { ...baseline, widths: [320, 640, 960] })).toBe(false);
  });

  it('returns false when formats differ', () => {
    expect(configsEqual(baseline, { ...baseline, formats: ['webp'] })).toBe(false);
  });

  it('returns false when quality differs', () => {
    expect(configsEqual(baseline, { ...baseline, quality: { webp: 80, avif: 60 } })).toBe(false);
  });

  it('returns false on null/undefined input', () => {
    expect(configsEqual(null, baseline)).toBe(false);
    expect(configsEqual(baseline, null)).toBe(false);
    expect(configsEqual(undefined, baseline)).toBe(false);
  });
});
