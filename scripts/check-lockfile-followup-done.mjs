/**
 * check-lockfile-followup-done — acceptance check for the "lockfile-version
 * follow-up isn't tracked" defect.
 *
 * PR #6 shipped scripts/check-lockfile-version.mjs (the drift detector) but
 * never touched package-lock.json itself, so the drift it detects
 * (root ".version" and .packages[""].version" still "1.1.0" against
 * package.json's "1.2.0") was left unfixed with nothing tracking it as open
 * work. package-lock.json is floored (never-touch) for every automated
 * pipeline stage in this repo, so the buildable fix here is a GitHub issue
 * that captures the drift and the documented hand-fix procedure — not a
 * code change.
 *
 * This is intentionally NOT a Vitest spec under tests/ and is not wired into
 * `npm test` or builder/verify.json, for the same reason
 * check-lockfile-version.mjs itself is kept standalone: it depends on state
 * (the git history of this branch, and live GitHub issue content) that a
 * hermetic, offline `npm ci && npm test` run should not depend on, and that
 * only a human/operator action (opening the issue) can satisfy — wiring it
 * into the gate would hold every future PR hostage to that action.
 *
 * Checks two things:
 *   1. Scope: this work item's commits (relative to `main`) must not modify
 *      package-lock.json, package.json, CLAUDE.md, or
 *      scripts/check-lockfile-version.mjs.
 *   2. Tracking: an open GitHub issue on koehler8/cms exists whose body
 *      documents the drift (1.1.0 -> 1.2.0), references PR #6, states PR #6
 *      shipped the detector but not the fix, documents the hand-fix
 *      procedure (nvm use first, edit only the two "version" string
 *      literals, no npm install/npm version/regen), and explains that
 *      package-lock.json is floored/never-touch for pipeline stages.
 *
 * Run manually: node scripts/check-lockfile-followup-done.mjs
 * Requires `gh` authenticated against github.com for the tracking check.
 * Exits 1 and prints exactly what's missing if either check fails; exits 0
 * once both are satisfied.
 */

import { execFileSync } from 'node:child_process';

const REPO = 'koehler8/cms';
const SCOPED_PATHS = [
  'package-lock.json',
  'package.json',
  'CLAUDE.md',
  'scripts/check-lockfile-version.mjs',
];

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf-8' }).trim();
}

function checkScope() {
  let baseRef;
  for (const candidate of ['origin/main', 'main']) {
    try {
      run('git', ['rev-parse', '--verify', candidate]);
      baseRef = candidate;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!baseRef) {
    return {
      ok: false,
      messages: ['  could not resolve a `main` ref (tried origin/main, main) to diff against'],
    };
  }

  let mergeBase;
  try {
    mergeBase = run('git', ['merge-base', 'HEAD', baseRef]);
  } catch (err) {
    return { ok: false, messages: [`  git merge-base HEAD ${baseRef} failed: ${err.message}`] };
  }

  const changed = run('git', ['diff', '--name-only', `${mergeBase}...HEAD`])
    .split('\n')
    .filter(Boolean);

  const touched = SCOPED_PATHS.filter((p) => changed.includes(p));
  if (touched.length > 0) {
    return {
      ok: false,
      messages: touched.map((p) => `  ${p} was modified by this work item but must stay untouched`),
    };
  }

  return { ok: true, messages: [] };
}

function findTrackingIssue() {
  const raw = run('gh', [
    'issue',
    'list',
    '-R',
    REPO,
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,body,url',
  ]);
  const issues = JSON.parse(raw);

  const requirements = [
    { label: 'mentions the current stale value "1.1.0"', test: (b) => b.includes('1.1.0') },
    { label: 'mentions the expected value "1.2.0"', test: (b) => b.includes('1.2.0') },
    { label: 'references PR #6', test: (b) => /#6\b/.test(b) },
    {
      label: 'states PR #6 shipped the detector but not the fix',
      test: (b) => /check[-:]lockfile-version/.test(b) && /(did not|didn't|never|not).{0,40}(touch|fix|update)/i.test(b),
    },
    { label: 'documents `nvm use` as a required first step', test: (b) => /nvm use/.test(b) },
    {
      label: 'documents that npm install/npm version/regen must not be used to fix it',
      test: (b) => /npm (install|version)/.test(b) && /(never|not|don't|do not)/i.test(b),
    },
    {
      label: 'explains package-lock.json is floored/never-touch for the pipeline',
      test: (b) => /package-lock\.json/.test(b) && /(floor|never.touch)/i.test(b),
    },
  ];

  for (const issue of issues) {
    const body = issue.body || '';
    const misses = requirements.filter((r) => !r.test(body)).map((r) => r.label);
    if (misses.length === 0) {
      return { ok: true, issue };
    }
  }

  return { ok: false, issues, requirements };
}

function checkTracking() {
  let result;
  try {
    result = findTrackingIssue();
  } catch (err) {
    return {
      ok: false,
      messages: [`  could not query GitHub issues via \`gh\` (${err.message})`],
    };
  }

  if (result.ok) {
    return { ok: true, messages: [`  found: ${result.issue.url}`] };
  }

  if (result.issues.length === 0) {
    return {
      ok: false,
      messages: [`  no open issues found on ${REPO} at all — none can be the tracking issue`],
    };
  }

  const messages = [`  no open issue on ${REPO} covers every required element:`];
  for (const issue of result.issues) {
    const body = issue.body || '';
    const misses = result.requirements.filter((r) => !r.test(body)).map((r) => r.label);
    if (misses.length < result.requirements.length) {
      messages.push(`    #${issue.number} "${issue.title}" is missing: ${misses.join('; ')}`);
    }
  }
  if (messages.length === 1) {
    messages.push('    (no candidate issue matched any required element)');
  }
  return { ok: false, messages };
}

async function main() {
  const scope = checkScope();
  const tracking = checkTracking();

  let ok = true;

  if (!scope.ok) {
    ok = false;
    console.error('Scope check failed — this work item must not modify these files:');
    console.error(scope.messages.join('\n'));
  } else {
    console.log('Scope check passed: package-lock.json, package.json, CLAUDE.md, and ' +
      'scripts/check-lockfile-version.mjs are untouched by this work item.');
  }

  if (!tracking.ok) {
    ok = false;
    console.error('Tracking check failed — no qualifying GitHub issue found:');
    console.error(tracking.messages.join('\n'));
  } else {
    console.log('Tracking check passed:');
    console.log(tracking.messages.join('\n'));
  }

  process.exitCode = ok ? 0 : 1;
}

await main();
