import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PR #6 shipped scripts/check-lockfile-version.mjs deliberately standalone —
// wiring it into `npm test` / builder/verify.json would hold the mandatory
// `npm ci && npm test` verify gate hostage to a package-lock.json fix that
// only a human can apply by hand (the file is floored/never-touch for every
// automated pipeline stage; see CLAUDE.md "Lockfile and npm version" and the
// script's own header comment). This guards that design decision: it fails
// the moment anything re-wires the detector into the gate.

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function readJson(relativePath) {
  const raw = await readFile(path.join(PROJECT_ROOT, relativePath), 'utf-8');
  return JSON.parse(raw);
}

describe('check-lockfile-version stays out of the automated gate', () => {
  it('is not referenced by any package.json script other than its own', async () => {
    const pkg = await readJson('package.json');
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === 'check:lockfile-version') continue;
      expect(command, `scripts.${name} must not invoke the lockfile-version detector`).not.toMatch(
        /check[-:]lockfile-version/
      );
    }
  });

  it('keeps its own npm script pointed at the standalone script file', async () => {
    const pkg = await readJson('package.json');
    expect(pkg.scripts['check:lockfile-version']).toBe('node scripts/check-lockfile-version.mjs');
  });

  it('is not referenced by builder/verify.json\'s gate commands', async () => {
    const verify = await readJson('builder/verify.json');
    const joined = verify.commands.join('\n');
    expect(joined).not.toMatch(/check[-:]lockfile-version/);
  });
});
