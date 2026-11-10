import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseNote,
  highestBump,
  nextVersion,
  buildSection,
  prependSection,
  plan,
  apply,
  NoteError,
} from '../../tools/release/release-from-changes.mjs';

const note = (bump, section, body) => `---\nbump: ${bump}\nsection: ${section}\n---\n${body}\n`;

describe('parseNote', () => {
  it('reads bump, section and body', () => {
    expect(parseNote('a.md', note('patch', 'Fixed', '- **Fixed X.**'))).toEqual({
      name: 'a.md',
      bump: 'patch',
      section: 'Fixed',
      body: '- **Fixed X.**',
    });
  });

  it('accepts any case and trailing comments', () => {
    const parsed = parseNote('a.md', '---\nbump: Minor   # new feature\nsection: added\n---\n- y\n');
    expect(parsed.bump).toBe('minor');
    expect(parsed.section).toBe('Added');
  });

  it('refuses a major so a breaking release is never automatic', () => {
    expect(() => parseNote('a.md', note('major', 'Changed', '- z'))).toThrow(/never released automatically/);
  });

  it.each([
    ['no front matter', '- just text\n', /front matter/],
    ['unknown bump', note('huge', 'Fixed', '- z'), /bump must be one of/],
    ['unknown section', note('patch', 'Misc', '- z'), /section must be one of/],
    ['empty body', note('patch', 'Fixed', '   '), /empty/],
  ])('refuses %s', (_label, text, message) => {
    expect(() => parseNote('a.md', text)).toThrow(NoteError);
    expect(() => parseNote('a.md', text)).toThrow(message);
  });
});

describe('version arithmetic', () => {
  it('takes the largest bump across notes', () => {
    expect(highestBump([{ bump: 'patch' }, { bump: 'patch' }])).toBe('patch');
    expect(highestBump([{ bump: 'patch' }, { bump: 'minor' }])).toBe('minor');
  });

  it('bumps patch and minor', () => {
    expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3');
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0');
  });

  it('refuses a prerelease line', () => {
    expect(() => nextVersion('1.5.0-beta.1', 'patch')).toThrow(/prerelease/);
  });
});

describe('changelog text', () => {
  const notes = [
    { bump: 'patch', section: 'Fixed', body: '- fix one' },
    { bump: 'minor', section: 'Added', body: '- feature' },
    { bump: 'patch', section: 'Fixed', body: '- fix two' },
  ];

  it('groups notes under their sections in canonical order', () => {
    expect(buildSection('1.5.0', notes)).toBe(
      '## 1.5.0\n\n### Added\n\n- feature\n\n### Fixed\n\n- fix one\n\n- fix two\n'
    );
  });

  it('inserts the new section above the newest release, below the title', () => {
    const changelog = '# Changelog\n\n## 1.4.2\n\n### Fixed\n\n- old\n';
    expect(prependSection(changelog, '## 1.4.3\n\n### Fixed\n\n- new\n')).toBe(
      '# Changelog\n\n## 1.4.3\n\n### Fixed\n\n- new\n\n## 1.4.2\n\n### Fixed\n\n- old\n'
    );
  });
});

describe('plan and apply on a repo', () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cms-release-'));
    await mkdir(path.join(root, '.changes'));
    await writeFile(path.join(root, '.changes', 'README.md'), '# how to write a note\n');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.4.2' }));
    await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 1.4.2\n\n- old\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('plans nothing when only the README is there', async () => {
    expect(await plan(root)).toEqual({ release: false });
  });

  it('plans nothing when the directory is missing', async () => {
    await rm(path.join(root, '.changes'), { recursive: true });
    expect(await plan(root)).toEqual({ release: false });
  });

  it('plans the next version from the notes', async () => {
    await writeFile(path.join(root, '.changes', 'b.md'), note('minor', 'Added', '- b'));
    await writeFile(path.join(root, '.changes', 'a.md'), note('patch', 'Fixed', '- a'));
    expect(await plan(root)).toEqual({ release: true, bump: 'minor', from: '1.4.2', to: '1.5.0', notes: ['a.md', 'b.md'] });
  });

  it('applies: writes the changelog, deletes the notes, keeps the README', async () => {
    await writeFile(path.join(root, '.changes', 'a.md'), note('patch', 'Fixed', '- a'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.4.3' }));
    expect(await apply(root, '1.4.3')).toEqual(['a.md']);
    expect(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).toBe(
      '# Changelog\n\n## 1.4.3\n\n### Fixed\n\n- a\n\n## 1.4.2\n\n- old\n'
    );
    expect(await readdir(path.join(root, '.changes'))).toEqual(['README.md']);
  });

  it('refuses to apply before npm version has moved package.json', async () => {
    await writeFile(path.join(root, '.changes', 'a.md'), note('patch', 'Fixed', '- a'));
    await expect(apply(root, '1.4.3')).rejects.toThrow(/run npm version first/);
  });

  it('refuses to write a section that already exists', async () => {
    await writeFile(path.join(root, '.changes', 'a.md'), note('patch', 'Fixed', '- a'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.4.2' }));
    await expect(apply(root, '1.4.2')).rejects.toThrow(/already has/);
  });

  it('a bad note fails the whole plan rather than releasing the rest', async () => {
    await writeFile(path.join(root, '.changes', 'a.md'), note('patch', 'Fixed', '- a'));
    await writeFile(path.join(root, '.changes', 'b.md'), note('major', 'Changed', '- b'));
    await expect(plan(root)).rejects.toThrow(/b\.md/);
  });
});
