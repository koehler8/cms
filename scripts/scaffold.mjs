// Shared core for the cms-create-{theme,extension} CLIs. Reads a template
// directory, substitutes __SLUG__ / __DISPLAY_NAME__ placeholders, writes
// the result to <cwd>/{themes,extensions}/<slug>/.
//
// Intentionally side-effect-free except for the file writes — wiring into
// the consuming site's package.json / vite.config.js is left to the user
// via the printed next-steps message. Modifying those files automatically
// would risk corrupting custom formatting and is harder to reverse than a
// copy/paste from the terminal.

import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Don't use `new URL('..', import.meta.url)` — vitest's happy-dom env can
// patch the URL constructor in ways that make fileURLToPath reject the
// result. Compute the path directly.
function defaultFrameworkRoot() {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    return null;
  }
}
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function toDisplayName(slug) {
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function parseArgs(argv) {
  const args = { slug: null, out: null, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--force' || a === '-f') args.force = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (!args.slug && !a.startsWith('-')) args.slug = a;
  }
  return args;
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function collectTemplateFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTemplateFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

function applySubstitutions(content, subs) {
  let result = content;
  for (const [from, to] of Object.entries(subs)) {
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * Run the scaffold for one of {theme, extension}.
 *
 * @param {object} opts
 * @param {'theme'|'extension'} opts.kind
 * @param {string[]} opts.argv  argv slice excluding `node` + script path
 * @param {string} opts.cwd     working directory (defaults to process.cwd())
 * @returns {Promise<{ok: boolean, slug?: string, targetDir?: string, message?: string}>}
 */
export async function runScaffold({ kind, argv, cwd = process.cwd(), frameworkRoot } = {}) {
  if (kind !== 'theme' && kind !== 'extension') {
    return { ok: false, message: `unknown kind: ${kind}` };
  }
  const root = frameworkRoot || defaultFrameworkRoot();
  if (!root) {
    return {
      ok: false,
      message: 'error: could not resolve @koehler8/cms framework root; pass `frameworkRoot` explicitly',
    };
  }
  const args = parseArgs(argv);

  if (args.help) {
    return { ok: true, message: usage(kind) };
  }
  if (!args.slug) {
    return { ok: false, message: `error: missing <slug>\n${usage(kind)}` };
  }
  if (!SLUG_PATTERN.test(args.slug)) {
    return {
      ok: false,
      message: `error: slug "${args.slug}" must be lowercase kebab-case (e.g. "coastal", "lush-canopy")`,
    };
  }

  const slug = args.slug;
  const displayName = toDisplayName(slug);
  const subs = { __SLUG__: slug, __DISPLAY_NAME__: displayName };
  const templateDir = path.join(root, 'templates', 'scaffolds', kind);
  const defaultDirName = kind === 'theme' ? 'themes' : 'extensions';
  const targetDir = args.out
    ? path.resolve(cwd, args.out)
    : path.join(cwd, defaultDirName, slug);

  if (!(await pathExists(templateDir))) {
    return {
      ok: false,
      message: `error: scaffold templates missing at ${templateDir}. Reinstall @koehler8/cms?`,
    };
  }
  if ((await pathExists(targetDir)) && !args.force) {
    return {
      ok: false,
      message: `error: target directory already exists: ${targetDir}\n(use --force to overwrite)`,
    };
  }

  const files = await collectTemplateFiles(templateDir);
  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    const rel = path.relative(templateDir, file);
    const outPath = path.join(targetDir, rel);
    await mkdir(path.dirname(outPath), { recursive: true });
    const raw = await readFile(file, 'utf8');
    await writeFile(outPath, applySubstitutions(raw, subs));
  }

  const targetRel = path.relative(cwd, targetDir) || targetDir;
  return {
    ok: true,
    slug,
    targetDir,
    message: `${successHeader(kind, slug, targetRel)}\n${nextSteps(kind, slug, targetRel)}`,
  };
}

function successHeader(kind, slug, targetRel) {
  const fileCount = kind === 'theme' ? 5 : 4;
  return `✓ Scaffolded ${kind} "${slug}" → ${targetRel}/ (${fileCount} files)`;
}

function nextSteps(kind, slug, targetRel) {
  if (kind === 'theme') {
    return [
      '',
      'Next steps:',
      '  1. Add to your site\'s package.json dependencies:',
      `       "cms-theme-${slug}": "file:./${targetRel}"`,
      '  2. Run `npm install` to symlink it into node_modules.',
      '  3. Add to vite.config.js\'s themes array:',
      `       themes: ['cms-theme-${slug}'],`,
      '  4. Activate it in site/content/{baseLocale}/site.json:',
      `       "theme": "${slug}"`,
      `  5. Edit ${targetRel}/theme.config.js to define your palette.`,
      '',
    ].join('\n');
  }
  return [
    '',
    'Next steps:',
    '  1. Add to your site\'s package.json dependencies:',
    `       "cms-ext-${slug}": "file:./${targetRel}"`,
    '  2. Run `npm install` to symlink it into node_modules.',
    '  3. Add to vite.config.js\'s extensions array:',
    `       extensions: ['cms-ext-${slug}'],`,
    `  4. Add components to ${targetRel}/components/ as needed (see ${targetRel}/README.md).`,
    `     Or, for one-off site-only components, prefer site/components/ instead.`,
    '',
  ].join('\n');
}

function usage(kind) {
  const cmd = kind === 'theme' ? 'cms-create-theme' : 'cms-create-extension';
  const dir = kind === 'theme' ? 'themes' : 'extensions';
  return `
Usage: npx ${cmd} <slug> [--out <directory>] [--force]

Scaffolds a new @koehler8/cms ${kind} into the current site.

Arguments:
  <slug>          Lowercase kebab-case slug (e.g. "coastal", "lush-canopy").

Options:
  --out <dir>     Where to create the ${kind}. Defaults to ./${dir}/<slug>/.
  --force         Overwrite an existing target directory.
  -h, --help      Show this message.
`;
}
