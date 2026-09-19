import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { diffDist, extractSignals } from '../../scripts/diff-ssg-dist.mjs';

function page({ title = 'Home', canonical = 'https://example.com/', body = '<section><h1>Hi</h1></section>' } = {}) {
  return `<!doctype html><html lang="en"><head>
<!-- <title>, <meta name="description"> and canonical are emitted by usePageMeta -->
<title>${title}</title>
<meta name="description" content="A site">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="de" href="https://example.com/de">
<script type="application/ld+json">{"@type":"Organization"}</script>
</head><body><div id="app">${body}</div>
<script>window.__INITIAL_STATE__={"a":1}</script></body></html>`;
}

describe('diff-ssg-dist: extractSignals', () => {
  it('reads the real <title>, not one mentioned inside an HTML comment', () => {
    expect(extractSignals(page({ title: 'Real Title' })).title).toBe('Real Title');
  });

  it('ignores inline <style>, which varies with the minifier', () => {
    const verbose = page({ body: '<style>/* note */ .a { opacity: 1 }</style><section><h1>Hi</h1></section>' });
    const minified = page({ body: '<style>.a{opacity:1}</style><section><h1>Hi</h1></section>' });
    expect(extractSignals(verbose)).toEqual(extractSignals(minified));
  });

  it('captures the SEO head and rendered structure', () => {
    const signals = extractSignals(page());
    expect(signals.lang).toBe('en');
    expect(signals.canonical).toEqual(['https://example.com/']);
    expect(signals.hreflang).toEqual(['de=https://example.com/de']);
    expect(signals.jsonLd).toHaveLength(1);
    expect(signals.sections).toBe(1);
    expect(signals.text).toBe('Hi');
  });
});

describe('diff-ssg-dist: diffDist', () => {
  let root;
  const write = async (dir, file, content) => {
    const target = path.join(root, dir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'diff-ssg-dist-'));
    for (const dir of ['before', 'after']) {
      await write(dir, 'index.html', page());
      await write(dir, 'about/index.html', page({ title: 'About', canonical: 'https://example.com/about' }));
      await write(dir, 'sitemap.xml', '<urlset/>');
      await write(dir, 'robots.txt', 'User-agent: *');
    }
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  const run = () => diffDist(path.join(root, 'before'), path.join(root, 'after'));

  it('passes identical trees and ignores hashed assets', async () => {
    await write('before', 'assets/app-aaaa.js', 'old');
    await write('after', 'assets/app-bbbb.js', 'new');
    const result = run();
    expect(result.pages).toBe(2);
    expect(result.differences).toEqual([]);
  });

  it('catches a silently-vanished component', async () => {
    await write('after', 'index.html', page({ body: '' }));
    expect(run().differences.map((d) => d.signal)).toEqual(expect.arrayContaining(['sections', 'headings', 'text']));
  });

  it('catches a dropped canonical', async () => {
    await write('after', 'about/index.html', page({ title: 'About' }).replace(/<link rel="canonical"[^>]*>/, ''));
    expect(run().differences).toEqual([expect.objectContaining({ page: 'about/index.html', signal: 'canonical' })]);
  });

  it('catches a route that disappeared', async () => {
    await rm(path.join(root, 'after', 'about'), { recursive: true });
    expect(run().differences).toEqual([expect.objectContaining({ page: 'about/index.html', signal: 'route' })]);
  });

  it('catches a changed sitemap', async () => {
    await write('after', 'sitemap.xml', '<urlset><url/></urlset>');
    expect(run().differences).toEqual([expect.objectContaining({ page: 'sitemap.xml', signal: 'bytes' })]);
  });
});
