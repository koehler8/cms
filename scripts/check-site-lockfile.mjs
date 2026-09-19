/**
 * check-site-lockfile — verify a consumer site's package-lock.json is safe to
 * push to AWS Amplify after a dependency bump.
 *
 * The documented #1 cause of consumer-site deploy failures (CLAUDE.md
 * "Lockfile and npm version") is a lockfile regenerated on the wrong npm
 * major: it looks fine on a Mac and then Amplify's Linux build dies with
 * `Cannot find module '@rolldown/binding-linux-x64-gnu'`, because the optional
 * platform-binary entries were stripped. Nothing local fails, so the only
 * defence is to inspect the lockfile before it ships.
 *
 * The invariant is NOT a count. rolldown 1.2.9 dropped its wasm32-wasi binding
 * and added an android one, so a healthy bump moved a site from 42 native
 * entries to 41 — a count check would have failed a good lockfile and could
 * pass a bad one. What must hold instead: every name a locked package lists
 * under `optionalDependencies` resolves to an entry in the same lockfile. The
 * parent's list survives a bad regen; the children are what go missing. That
 * needs no network and no knowledge of which packages happen to be native.
 *
 * Like check-lockfile-version this is a standalone detector, deliberately not
 * wired into `npm test` or builder/verify.json: it inspects a SITE's lockfile,
 * not this repo's.
 *
 * Run: node scripts/check-site-lockfile.mjs [siteDir]   (default: cwd)
 * Exits 1 and lists every problem; exits 0 when the lockfile is clean.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A second copy of any of these means two module instances at runtime — the
// reason the framework excludes them from Vite's dep pre-bundling.
const SINGLETONS = ['vue', 'vue-router', 'pinia', '@unhead/vue'];

// The two binaries whose absence has actually taken Amplify builds down.
// Checked by name on top of the general rule so the failure message is direct.
const AMPLIFY_BINARIES = [
  { parent: 'rolldown', binary: '@rolldown/binding-linux-x64-gnu' },
  { parent: 'sharp', binary: '@img/sharp-linux-x64' },
];

const REGISTRY = 'https://registry.npmjs.org/';

/** npm's resolution walk: nearest node_modules first, then each ancestor's. */
function resolveFrom(packages, parentKey, name) {
  let base = parentKey;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

export function checkLockfile(lock) {
  const problems = [];
  const packages = lock?.packages ?? {};

  if (lock?.lockfileVersion !== 3) {
    problems.push(`lockfileVersion is ${lock?.lockfileVersion}, expected 3`);
  }

  for (const [key, entry] of Object.entries(packages)) {
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      if (!resolveFrom(packages, key, name)) {
        problems.push(
          `${key || '(root)'} lists optional dependency "${name}" but the lockfile has no entry for it`
        );
      }
    }
  }

  for (const { parent, binary } of AMPLIFY_BINARIES) {
    if (!packages[`node_modules/${parent}`]) continue;
    const entry = packages[`node_modules/${binary}`];
    if (!entry) {
      problems.push(`${parent} is locked but ${binary} is missing — Amplify's Linux build will fail`);
    } else if (!entry.resolved || !entry.integrity) {
      problems.push(`${binary} has no resolved/integrity — npm cannot install it on Amplify`);
    }
  }

  for (const name of SINGLETONS) {
    const copies = Object.keys(packages).filter(
      (key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)
    );
    if (copies.length > 1) {
      problems.push(`${copies.length} copies of ${name} (${copies.join(', ')}) — must be exactly one`);
    }
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (!entry.resolved || entry.link) continue;
    const isLocal = !/^[a-z][a-z0-9+.-]*:/i.test(entry.resolved);
    if (!isLocal && !entry.resolved.startsWith(REGISTRY)) {
      problems.push(`${key} resolves outside the npm registry: ${entry.resolved}`);
    }
  }

  return problems;
}

async function main() {
  const siteDir = resolve(process.argv[2] ?? process.cwd());
  const lock = JSON.parse(await readFile(join(siteDir, 'package-lock.json'), 'utf-8'));
  const problems = checkLockfile(lock);

  if (problems.length > 0) {
    console.error(`package-lock.json in ${siteDir} is NOT safe to push:`);
    console.error(problems.map((problem) => `  - ${problem}`).join('\n'));
    console.error(
      '\nIf optional-dependency entries are missing, the lockfile was almost certainly written by ' +
        'the wrong npm major. Revert it (`git checkout HEAD -- package-lock.json`), run `nvm use`, ' +
        'and redo the bump with a targeted `npm install <pkg>@<ver>`.'
    );
    process.exitCode = 1;
    return;
  }

  const count = Object.keys(lock.packages ?? {}).length;
  console.log(`package-lock.json in ${siteDir} is clean (${count} entries, all optional dependencies present).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
