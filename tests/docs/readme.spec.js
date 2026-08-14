import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This suite checks the *published-facing docs* (README.md, CLAUDE.md) against
// the actual publish target, not source code. There's no other mechanism that
// would catch these two files drifting from reality again.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let readme;
let claudeMd;

beforeAll(async () => {
  readme = await readFile(path.join(PROJECT_ROOT, 'README.md'), 'utf-8');
  claudeMd = await readFile(path.join(PROJECT_ROOT, 'CLAUDE.md'), 'utf-8');
});

describe('README.md publish/install instructions', () => {
  it('does not tell installers to point the @koehler8 scope at GitHub Packages', () => {
    expect(readme).not.toMatch(/npm\.pkg\.github\.com/);
    expect(readme).not.toMatch(/@koehler8:registry\s*=/);
  });

  it('does not carry a "GitHub Packages" shields.io badge', () => {
    expect(readme).not.toMatch(/GitHub%20Packages/i);
    expect(readme).not.toMatch(/GitHub Packages/);
  });

  it('states the actual publish target: the public npm registry', () => {
    expect(readme).toMatch(/registry\.npmjs\.org|public npm registry/i);
  });

  it('Quick Start install command does not use the bare (unpinned) @koehler8/cms specifier', () => {
    // The bare specifier resolves to the `latest` dist-tag, which is frozen at
    // 1.0.0-beta.5 (the first-ever publish) — see npm view @koehler8/cms dist-tags.
    // Every `npm install ...` line that installs @koehler8/cms must pin a version/range.
    const installLines = readme
      .split('\n')
      .filter((line) => /npm install .*@koehler8\/cms\b/.test(line));

    expect(installLines.length).toBeGreaterThan(0);
    for (const line of installLines) {
      expect(line).not.toMatch(/@koehler8\/cms(?!@)(\s|$)/);
      expect(line).toMatch(/@koehler8\/cms@\S+/);
    }
  });

  it('pins the install to an explicit prerelease range consistent with the fleet convention', () => {
    expect(readme).toMatch(/@koehler8\/cms@\^?1\.0\.0-beta/);
  });
});

describe('CLAUDE.md project overview', () => {
  it('does not claim the package publishes to GitHub Packages', () => {
    const overviewLine = claudeMd
      .split('\n')
      .find((line) => line.includes('Vertex CMS (`@koehler8/cms`)'));

    expect(overviewLine).toBeDefined();
    expect(overviewLine).not.toMatch(/GitHub Packages/);
  });

  it('is internally consistent: no mention of GitHub Packages as a publish target anywhere in the file', () => {
    // CLAUDE.md's own "Publishing" section already correctly says "public npm
    // registry (registry.npmjs.org) — not GitHub Packages". Guard against the
    // overview re-introducing the contradiction this defect was about.
    expect(claudeMd).not.toMatch(/published[^.\n]*GitHub Packages/);
  });
});
