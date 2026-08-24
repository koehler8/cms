/**
 * check-lockfile-version — detect drift between package.json's version and
 * package-lock.json's two self-reported version fields (root `.version` and
 * `.packages[""].version`).
 *
 * This is intentionally NOT a Vitest spec under tests/, and is not wired
 * into `npm test`. package-lock.json is a floored, never-touch file for
 * every automated pipeline stage in this repo (see CLAUDE.md "Lockfile and
 * npm version" and the product skill's "Never touch" list) — a full lockfile
 * regen on the wrong npm version is the documented #1 cause of consumer-site
 * deploy failures, so no stage here is permitted to edit it, not even for a
 * narrow two-field metadata correction. A Vitest spec asserting these fields
 * match would therefore stay red until a human fixes the file by hand, which
 * would permanently fail the mandatory `npm ci && npm test` verify gate for
 * every future PR. Keeping this check standalone lets it detect and report
 * the drift without holding CI hostage to a fix only a human can apply.
 *
 * Run manually: node scripts/check-lockfile-version.mjs
 * Exits 1 and prints the stale fields if package-lock.json's version fields
 * don't match package.json's version; exits 0 otherwise.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

async function main() {
  const packageJson = JSON.parse(await readFile(join(ROOT_DIR, 'package.json'), 'utf-8'));
  const lockJson = JSON.parse(await readFile(join(ROOT_DIR, 'package-lock.json'), 'utf-8'));

  const expected = packageJson.version;
  const stale = [];
  if (lockJson.version !== expected) {
    stale.push(`  package-lock.json ".version" is "${lockJson.version}", expected "${expected}"`);
  }
  if (lockJson.packages?.['']?.version !== expected) {
    stale.push(
      `  package-lock.json ".packages[\\"\\"].version" is "${lockJson.packages?.['']?.version}", expected "${expected}"`
    );
  }

  if (stale.length > 0) {
    console.error(`package-lock.json version drift detected (package.json is at "${expected}"):`);
    console.error(stale.join('\n'));
    console.error(
      '\npackage-lock.json is floored (never-touch) for every pipeline stage in this repo — ' +
        'this must be corrected by hand, outside the pipeline, and pushed directly ' +
        '(same as any dependency-version change; see CLAUDE.md "Lockfile and npm version"). ' +
        'Edit only the two "version" string literals above; do not run `npm install`, ' +
        '`npm version`, or any lockfile regen.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`package-lock.json version fields match package.json ("${expected}").`);
}

await main();
