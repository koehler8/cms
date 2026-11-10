#!/usr/bin/env node
// Turns the change notes in `.changes/*.md` into a release: the next version
// and a CHANGELOG.md section. Run by `.github/workflows/publish.yml` on every
// push to main; a person can run `plan` locally to preview.
//
//   node tools/release/release-from-changes.mjs plan
//     → prints {"release":false} or {"release":true,"bump","from","to","notes"}
//   node tools/release/release-from-changes.mjs apply --version <x.y.z>
//     → prepends the CHANGELOG.md section for <x.y.z> and deletes the notes
//
// The workflow sets the version itself with `npm version <x.y.z>
// --no-git-tag-version` between the two calls, so package.json and both
// lockfile version fields move together.
//
// A note is one markdown file per change:
//
//   ---
//   bump: patch          # patch | minor — a major is never automatic
//   section: Fixed       # Added | Changed | Deprecated | Removed | Fixed | Security
//   ---
//   - **What changed, in a sentence.** Why it matters to a site.
//
// Lives under tools/ (outside package.json `files`) so it never ships to npm.

import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUMPS = ['patch', 'minor'];
export const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const IGNORED = new Set(['README.md']);

export class NoteError extends Error {}

export function parseNote(name, text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new NoteError(`${name}: missing the --- front matter block (bump, section)`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^\s*([a-z]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (field) fields[field[1]] = field[2];
  }
  const bump = (fields.bump || '').toLowerCase();
  if (bump === 'major') {
    throw new NoteError(`${name}: bump "major" is never released automatically — cut a major by hand (CLAUDE.md → Publishing)`);
  }
  if (!BUMPS.includes(bump)) throw new NoteError(`${name}: bump must be one of ${BUMPS.join(', ')} (got "${fields.bump ?? ''}")`);
  const section = SECTIONS.find((s) => s.toLowerCase() === (fields.section || '').toLowerCase());
  if (!section) throw new NoteError(`${name}: section must be one of ${SECTIONS.join(', ')} (got "${fields.section ?? ''}")`);
  const body = match[2].trim();
  if (!body) throw new NoteError(`${name}: the changelog text under the front matter is empty`);
  return { name, bump, section, body };
}

export function highestBump(notes) {
  return notes.some((note) => note.bump === 'minor') ? 'minor' : 'patch';
}

export function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    throw new NoteError(`package.json version "${current}" is not a plain x.y.z release (a prerelease line is cut by hand)`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return bump === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

export function buildSection(version, notes) {
  const parts = [`## ${version}`];
  for (const section of SECTIONS) {
    const bodies = notes.filter((note) => note.section === section).map((note) => note.body);
    if (bodies.length) parts.push(`### ${section}`, bodies.join('\n\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

// Insert before the first existing `## ` release header, so the `# Changelog`
// title and any intro text stay on top.
export function prependSection(changelog, section) {
  const at = changelog.search(/^## /m);
  if (at === -1) return `${changelog.replace(/\s*$/, '')}\n\n${section}`;
  return `${changelog.slice(0, at)}${section}\n${changelog.slice(at)}`;
}

export async function readNotes(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = names.filter((name) => name.endsWith('.md') && !IGNORED.has(name)).sort();
  const notes = [];
  for (const name of files) notes.push(parseNote(name, await readFile(path.join(dir, name), 'utf8')));
  return notes;
}

export async function plan(root) {
  const notes = await readNotes(path.join(root, '.changes'));
  if (!notes.length) return { release: false };
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const bump = highestBump(notes);
  return { release: true, bump, from: pkg.version, to: nextVersion(pkg.version, bump), notes: notes.map((n) => n.name) };
}

export async function apply(root, version) {
  const dir = path.join(root, '.changes');
  const notes = await readNotes(dir);
  if (!notes.length) throw new NoteError('apply: no change notes in .changes/');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== version) {
    throw new NoteError(`apply: package.json says ${pkg.version} but --version is ${version} — run npm version first`);
  }
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelog = await readFile(changelogPath, 'utf8');
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(changelog)) {
    throw new NoteError(`apply: CHANGELOG.md already has a ## ${version} section`);
  }
  await writeFile(changelogPath, prependSection(changelog, buildSection(version, notes)));
  for (const note of notes) await unlink(path.join(dir, note.name));
  return notes.map((n) => n.name);
}

async function main(argv) {
  const root = process.cwd();
  const [command, ...rest] = argv;
  if (command === 'plan') {
    console.log(JSON.stringify(await plan(root)));
  } else if (command === 'apply') {
    const at = rest.indexOf('--version');
    const version = at === -1 ? undefined : rest[at + 1];
    if (!version) throw new NoteError('apply needs --version <x.y.z>');
    const applied = await apply(root, version);
    console.log(`CHANGELOG.md: added ## ${version} from ${applied.join(', ')}`);
  } else {
    throw new NoteError('usage: release-from-changes.mjs plan | apply --version <x.y.z>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof NoteError ? `::error::${err.message}` : err);
    process.exit(1);
  });
}
