import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findEmptyRenders } from '../../scripts/ssg-build/findEmptyRenders.mjs';

const dirs = [];

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-ssg-build-test-'));
  dirs.push(dir);
  return dir;
}

async function writeHtml(dir, relPath, body) {
  const full = path.join(dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const EMPTY_APP = '<!doctype html><html><body><div id="app" data-server-rendered="true"><!----></div></body></html>';
const REAL_APP = '<!doctype html><html><body><div id="app" data-server-rendered="true"><main id="main-content">Hello</main></div></body></html>';

describe('findEmptyRenders', () => {
  it('returns an empty list for a directory with no matches', async () => {
    const dir = await makeTmpDir();
    await writeHtml(dir, 'index.html', REAL_APP);
    await writeHtml(dir, 'about/index.html', REAL_APP);
    expect(await findEmptyRenders(dir)).toEqual([]);
  });

  it('flags a page whose root container has no rendered markup', async () => {
    const dir = await makeTmpDir();
    await writeHtml(dir, 'index.html', EMPTY_APP);
    const result = await findEmptyRenders(dir);
    expect(result).toEqual([path.join(dir, 'index.html')]);
  });

  it('recurses into nested route directories', async () => {
    const dir = await makeTmpDir();
    await writeHtml(dir, 'index.html', REAL_APP);
    await writeHtml(dir, 'crew/index.html', EMPTY_APP);
    await writeHtml(dir, 'de/crew/index.html', EMPTY_APP);
    const result = await findEmptyRenders(dir);
    expect(result.sort()).toEqual(
      [path.join(dir, 'crew/index.html'), path.join(dir, 'de/crew/index.html')].sort(),
    );
  });

  it('ignores non-index.html files', async () => {
    const dir = await makeTmpDir();
    await writeHtml(dir, 'assets/main.js', '<div id="app"><!----></div>'); // matches the pattern but isn't an index.html
    expect(await findEmptyRenders(dir)).toEqual([]);
  });

  it('does not flag a root container with real nested content', async () => {
    const dir = await makeTmpDir();
    await writeHtml(dir, 'index.html', '<div id="app" data-server-rendered="true"><!--[--><header></header><main></main><!--]--></div>');
    expect(await findEmptyRenders(dir)).toEqual([]);
  });

  it('returns an empty list for a directory that does not exist', async () => {
    expect(await findEmptyRenders('/nonexistent/path/that/should/not/exist')).toEqual([]);
  });
});
