/**
 * Per-site migration helper for the cms@1.0.0-beta.27 in-plugin image
 * variant pipeline.
 *
 * Run from a site directory:
 *   npx @koehler8/cms migrate-image-variants
 *
 * What it does (idempotent — running it on an already-migrated site is a
 * series of no-ops):
 *   1. Validate this is a cms-using site (check package.json deps).
 *   2. Promote site/assets/img/_source/* originals to flat dir, delete
 *      duplicate copies left over from beta.26's auto-copy step, then
 *      remove the now-empty _source/ directory.
 *   3. git rm --cached any committed variants matching {name}-{N}.{ext}
 *      and append the patterns to .gitignore for future-proofing.
 *   4. Drop the `generate:image-variants` entry from package.json scripts.
 *   5. Drop the `npm run generate:image-variants` line from amplify.yml.
 *   6. Bump @koehler8/cms range to ^1.0.0-beta.27.
 *   7. Run npm install --prefer-offline --no-audit --no-fund.
 *   8. Print verification instructions.
 *
 * Does NOT auto-commit or auto-push — humans review the diff.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const TARGET_CMS_VERSION = '^1.0.0-beta.27';
const VARIANT_NAME_RE = /-\d+\.(?:avif|webp|jpg|jpeg)$/i;

function log(msg) {
  console.log(msg);
}
function step(n, msg) {
  console.log(`${BOLD}[${n}]${RESET} ${msg}`);
}
function ok(msg) {
  console.log(`    ${GREEN}✓${RESET} ${msg}`);
}
function info(msg) {
  console.log(`    ${DIM}·${RESET} ${DIM}${msg}${RESET}`);
}
function warn(msg) {
  console.log(`    ${YELLOW}!${RESET} ${msg}`);
}
function fail(msg) {
  console.log(`    ${RED}✗${RESET} ${RED}${msg}${RESET}`);
}

function readJsonOrNull(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function* walkRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) yield full;
    }
  }
}

function gitTryRm(siteDir, files) {
  if (!files.length) return 0;
  try {
    const args = files.map((f) => `'${path.relative(siteDir, f).replace(/'/g, "'\\''")}'`).join(' ');
    execSync(`git rm --cached --quiet ${args}`, { cwd: siteDir, stdio: 'pipe' });
    return files.length;
  } catch {
    return 0;
  }
}

function isCmsSite(siteDir) {
  const pkg = readJsonOrNull(path.join(siteDir, 'package.json'));
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.['@koehler8/cms'] || pkg.devDependencies?.['@koehler8/cms']);
}

function migrateSourceDir(siteDir) {
  const imgDir = path.join(siteDir, 'assets', 'img');
  const altImgDir = path.join(siteDir, 'site', 'assets', 'img');
  const target = fs.existsSync(altImgDir) ? altImgDir : imgDir;
  const sourceDir = path.join(target, '_source');
  if (!fs.existsSync(sourceDir)) {
    info('no site/assets/img/_source/ to migrate');
    return;
  }
  let promoted = 0;
  let deletedDup = 0;
  for (const sourcePath of walkRecursive(sourceDir)) {
    const rel = path.relative(sourceDir, sourcePath);
    const flatPath = path.join(target, rel);
    if (fs.existsSync(flatPath)) {
      fs.rmSync(sourcePath, { force: true });
      deletedDup += 1;
    } else {
      fs.mkdirSync(path.dirname(flatPath), { recursive: true });
      fs.renameSync(sourcePath, flatPath);
      promoted += 1;
    }
  }
  function removeEmptyDirs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
    }
    if (!fs.readdirSync(dir).length) {
      fs.rmdirSync(dir);
    }
  }
  removeEmptyDirs(sourceDir);
  if (promoted) ok(`promoted ${promoted} originals from _source/ to flat dir`);
  if (deletedDup) ok(`removed ${deletedDup} duplicate copies left in _source/`);
  if (!fs.existsSync(sourceDir)) ok('removed empty _source/ directory');
}

function untrackVariants(siteDir) {
  const candidates = [
    path.join(siteDir, 'assets', 'img'),
    path.join(siteDir, 'site', 'assets', 'img'),
  ].filter((d) => fs.existsSync(d));
  const variantPaths = [];
  for (const dir of candidates) {
    for (const f of walkRecursive(dir)) {
      if (f.includes(`${path.sep}_source${path.sep}`)) continue;
      if (VARIANT_NAME_RE.test(f)) variantPaths.push(f);
    }
  }
  if (!variantPaths.length) {
    info('no committed variants to untrack');
    return;
  }
  const untracked = gitTryRm(siteDir, variantPaths);
  if (untracked) {
    ok(`git rm --cached on ${untracked} variant file(s) (kept on disk)`);
    for (const v of variantPaths) {
      try { fs.rmSync(v, { force: true }); } catch { /* noop */ }
    }
    ok(`removed ${variantPaths.length} variant file(s) from working tree`);
  } else {
    warn(`found ${variantPaths.length} variant-shaped files but git rm failed (not in git or git not present); deleting from disk anyway`);
    for (const v of variantPaths) {
      try { fs.rmSync(v, { force: true }); } catch { /* noop */ }
    }
  }
}

function appendGitignore(siteDir) {
  const gi = path.join(siteDir, '.gitignore');
  const block = [
    '',
    '# Image variants are generated at build time into node_modules/.cache/',
    '# (cms@1.0.0-beta.27+ pipeline). Defensive ignore so accidental local',
    '# variants in the source tree don’t get committed.',
    'site/assets/img/*-[0-9]*.avif',
    'site/assets/img/*-[0-9]*.webp',
    'site/assets/img/*-[0-9]*.jpg',
    'site/assets/img/*-[0-9]*.jpeg',
    'site/assets/img/**/*-[0-9]*.avif',
    'site/assets/img/**/*-[0-9]*.webp',
    'site/assets/img/**/*-[0-9]*.jpg',
    'site/assets/img/**/*-[0-9]*.jpeg',
    'assets/img/*-[0-9]*.avif',
    'assets/img/*-[0-9]*.webp',
    'assets/img/*-[0-9]*.jpg',
    'assets/img/*-[0-9]*.jpeg',
    '',
  ].join('\n');
  let cur = '';
  if (fs.existsSync(gi)) cur = fs.readFileSync(gi, 'utf-8');
  if (cur.includes('# Image variants are generated at build time')) {
    info('.gitignore already has image-variant patterns');
    return;
  }
  fs.writeFileSync(gi, cur + (cur.endsWith('\n') ? '' : '\n') + block);
  ok('appended image-variant patterns to .gitignore');
}

function dropPackageJsonScript(siteDir) {
  const pkgPath = path.join(siteDir, 'package.json');
  const pkg = readJsonOrNull(pkgPath);
  if (!pkg) {
    fail('package.json missing');
    return;
  }
  if (pkg.scripts?.['generate:image-variants']) {
    delete pkg.scripts['generate:image-variants'];
    writeJson(pkgPath, pkg);
    ok('removed generate:image-variants script from package.json');
  } else {
    info('package.json scripts already clean');
  }
}

function dropAmplifyStep(siteDir) {
  const ymlPath = path.join(siteDir, 'amplify.yml');
  if (!fs.existsSync(ymlPath)) {
    info('no amplify.yml present');
    return;
  }
  const cur = fs.readFileSync(ymlPath, 'utf-8');
  const next = cur
    .split(/\r?\n/)
    .filter((line) => !/^\s*-\s*npm\s+run\s+generate:image-variants\s*$/.test(line))
    .join('\n');
  if (next === cur) {
    info('amplify.yml already clean');
    return;
  }
  fs.writeFileSync(ymlPath, next);
  ok('removed generate:image-variants step from amplify.yml');
}

function bumpCmsVersion(siteDir) {
  const pkgPath = path.join(siteDir, 'package.json');
  const pkg = readJsonOrNull(pkgPath);
  if (!pkg) return;
  let bumped = false;
  if (pkg.dependencies?.['@koehler8/cms'] && pkg.dependencies['@koehler8/cms'] !== TARGET_CMS_VERSION) {
    pkg.dependencies['@koehler8/cms'] = TARGET_CMS_VERSION;
    bumped = true;
  }
  if (pkg.devDependencies?.['@koehler8/cms'] && pkg.devDependencies['@koehler8/cms'] !== TARGET_CMS_VERSION) {
    pkg.devDependencies['@koehler8/cms'] = TARGET_CMS_VERSION;
    bumped = true;
  }
  if (bumped) {
    writeJson(pkgPath, pkg);
    ok(`bumped @koehler8/cms to ${TARGET_CMS_VERSION}`);
  } else {
    info(`@koehler8/cms already at ${TARGET_CMS_VERSION}`);
  }
}

function runNpmInstall(siteDir) {
  try {
    execSync('npm install --prefer-offline --no-audit --no-fund', {
      cwd: siteDir,
      stdio: 'inherit',
    });
    ok('npm install completed');
  } catch (err) {
    fail(`npm install failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function main() {
  const siteDir = path.resolve(process.cwd());
  log('');
  log(`${BOLD}cms image-variant migration${RESET}`);
  log(`${DIM}site:${RESET} ${siteDir}`);
  log('');

  if (!isCmsSite(siteDir)) {
    fail('Not a @koehler8/cms-consuming site (no @koehler8/cms in package.json deps).');
    process.exit(1);
  }

  step(1, 'Promote originals from _source/ to flat dir');
  migrateSourceDir(siteDir);

  step(2, 'Untrack and remove committed variants');
  untrackVariants(siteDir);

  step(3, 'Append image-variant patterns to .gitignore');
  appendGitignore(siteDir);

  step(4, 'Remove generate:image-variants script from package.json');
  dropPackageJsonScript(siteDir);

  step(5, 'Remove generate:image-variants step from amplify.yml');
  dropAmplifyStep(siteDir);

  step(6, `Bump @koehler8/cms to ${TARGET_CMS_VERSION}`);
  bumpCmsVersion(siteDir);

  step(7, 'npm install');
  runNpmInstall(siteDir);

  log('');
  log(`${BOLD}${GREEN}Done.${RESET}`);
  log('');
  log('Next steps:');
  log(`  ${DIM}·${RESET} npm run build:ssg     # verify variants render in dist/`);
  log(`  ${DIM}·${RESET} git diff               # review the changes`);
  log(`  ${DIM}·${RESET} git add -A && git commit && git push`);
  log('');
}

main();
