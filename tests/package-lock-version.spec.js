import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression suite for the 1.2.0 release defect: package.json's version was
// bumped for the release, but package-lock.json's two self-reported version
// fields (the root `.version` and `.packages[""].version`) were never
// touched and stayed on the prior release's value. `git diff v1.1.0 v1.2.0
// -- package.json package-lock.json` showed package-lock.json had ZERO
// changes across the release — the bump was missed outright.
//
// The fix is a hand-edit of exactly those two string literals to match
// package.json's version. No `npm install` / `npm version` / lockfile
// regen — an npm-10-vs-11 regen is the documented #1 cause of consumer-site
// deploy failures for this framework (see CLAUDE.md "Lockfile and npm
// version"), and this defect needs none of that machinery.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let packageJson;
let lockRaw;
let lockJson;

beforeAll(async () => {
  const packageJsonRaw = await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8');
  packageJson = JSON.parse(packageJsonRaw);
  lockRaw = await readFile(path.join(PROJECT_ROOT, 'package-lock.json'), 'utf-8');
  lockJson = JSON.parse(lockRaw);
});

describe('package-lock.json version fields track package.json (AC-10560483, AC-72B2DCEC, AC-EB89A1BE)', () => {
  it('package.json declares a version to compare against', () => {
    expect(typeof packageJson.version).toBe('string');
    expect(packageJson.version.length).toBeGreaterThan(0);
  });

  it("package-lock.json's root .version matches package.json's version", () => {
    expect(lockJson.version).toBe(packageJson.version);
  });

  it('package-lock.json\'s packages[""].version matches package.json\'s version', () => {
    expect(lockJson.packages['']).toBeDefined();
    expect(lockJson.packages[''].version).toBe(packageJson.version);
  });
});

// AC-972DD359: the fix must touch ONLY those two version string literals —
// nothing else in the (5000+ line, hand-generated) dependency tree may
// change. A blind global find/replace of the old version string would be
// wrong here: package-lock.json also happens to pin unrelated third-party
// packages at the exact same "1.1.0" version the framework itself was on
// (confirmed independently at authoring time — grep -c '"version": "1.1.0"'
// package-lock.json reported 4 hits: the two target fields plus two
// unrelated dependency entries). This guard normalizes ONLY the root and
// packages[""] version fields (matched structurally, by their surrounding
// JSON context, not by string value) and hashes the rest of the file, so
// any change to any other line — including an accidental hit on one of
// those unrelated "1.1.0" dependency entries, or a full lockfile regen —
// fails the hash comparison.
describe('package-lock.json diff stays scoped to exactly the two version fields (AC-972DD359)', () => {
  // Captured against the pre-fix file (both target fields still "1.1.0")
  // and independently confirmed stable under the post-fix value ("1.2.0")
  // by construction: the normalization strips the version value itself
  // before hashing, so a correctly-scoped edit reproduces this hash
  // regardless of which version string is in place.
  const EXPECTED_NORMALIZED_HASH =
    '4f5d3da7e841a56ff7de8f75c60a7fd0410fa7f9331eac300b2fe3d0bf538071';

  const ROOT_VERSION_FIELD = /^(\{\n {2}"name": "@koehler8\/cms",\n {2}"version": ")[^"]+(")/;
  const NESTED_VERSION_FIELD =
    /("packages": \{\n {4}"": \{\n {6}"name": "@koehler8\/cms",\n {6}"version": ")[^"]+(")/;

  it('locates both target version fields by their structural context', () => {
    expect(lockRaw).toMatch(ROOT_VERSION_FIELD);
    expect(lockRaw).toMatch(NESTED_VERSION_FIELD);
  });

  it('every other byte of package-lock.json is unchanged from the pre-fix baseline', () => {
    const normalized = lockRaw
      .replace(ROOT_VERSION_FIELD, '$1<version>$2')
      .replace(NESTED_VERSION_FIELD, '$1<version>$2');
    const hash = createHash('sha256').update(normalized).digest('hex');
    expect(hash).toBe(EXPECTED_NORMALIZED_HASH);
  });
});

// AC-1E3D4FFE regression guard: this is a metadata-only fix, so nothing about
// the dependency graph itself should move. A structural sanity check —
// full `npm ci` + `npm test` is the actual verify gate, run separately.
describe('package-lock.json stays structurally installable', () => {
  it('keeps lockfileVersion 3 and the requires flag npm ci depends on', () => {
    expect(lockJson.lockfileVersion).toBe(3);
    expect(lockJson.requires).toBe(true);
  });
});
