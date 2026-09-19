/**
 * diff-ssg-dist — compare two SSG `dist/` trees page by page on everything a
 * dependency bump must NOT change: the route list, each page's SEO head, and
 * the rendered structure and text.
 *
 * Consumer sites have no test suite; a green `build:ssg` is their only gate,
 * and it cannot see the failures that matter. A component whose content block
 * stopped resolving renders nothing, silently. A head-management regression
 * drops canonicals or hreflang without a warning. Both build clean. So build
 * once before the bump, once after, and diff what the crawler and the visitor
 * would actually receive.
 *
 * Hashed asset filenames and bundled JS are expected to differ and are ignored.
 * HTML comments and inline <style> are stripped first: a comment can mention a
 * tag ("<title> is emitted by usePageMeta…") and inline CSS is
 * minifier-dependent — neither is content, and both produced false diffs.
 *
 * Run: node scripts/diff-ssg-dist.mjs <dist-before> <dist-after>
 * Exits 1 on any difference; exits 0 when every page matches.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const all = (html, re) => [...html.matchAll(re)].map((match) => match[1] ?? match[0]);
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] ?? null;
const count = (html, re) => (html.match(re) || []).length;

export function extractSignals(rawHtml) {
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/) || [])[1] ?? '';
  const links = all(head, /<link\b[^>]*>/g);
  const metas = all(head, /<meta\b[^>]*>/g);
  const meta = (key, value) =>
    metas.filter((tag) => attr(tag, key) === value).map((tag) => attr(tag, 'content')).sort();
  const body = ((html.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [])[1] ?? '').replace(
    /<script[\s\S]*?<\/script>/g,
    ''
  );

  return {
    lang: attr((html.match(/<html\b[^>]*>/) || [''])[0], 'lang'),
    title: (head.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? null,
    description: meta('name', 'description'),
    robots: meta('name', 'robots'),
    canonical: links.filter((tag) => attr(tag, 'rel') === 'canonical').map((tag) => attr(tag, 'href')),
    hreflang: links
      .filter((tag) => attr(tag, 'rel') === 'alternate' && attr(tag, 'hreflang'))
      .map((tag) => `${attr(tag, 'hreflang')}=${attr(tag, 'href')}`)
      .sort(),
    ogUrl: meta('property', 'og:url'),
    ogTitle: meta('property', 'og:title'),
    ogImage: meta('property', 'og:image'),
    jsonLd: all(html, /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g).sort(),
    // Structure counts are what catch a silently-vanished component.
    sections: count(body, /<section\b/g),
    headings: count(body, /<h[1-6]\b/g),
    links: count(body, /<a\b/g),
    images: count(body, /<img\b/g),
    text: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

export function initialStateBytes(rawHtml) {
  return ((rawHtml.match(/__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/) || [])[1] ?? '').length;
}

function htmlFiles(root, dir = root, out = new Map()) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) htmlFiles(root, path, out);
    else if (name.endsWith('.html')) out.set(relative(root, path), path);
  }
  return out;
}

export function diffDist(beforeDir, afterDir) {
  const before = htmlFiles(beforeDir);
  const after = htmlFiles(afterDir);
  const differences = [];

  const removed = [...before.keys()].filter((page) => !after.has(page));
  const added = [...after.keys()].filter((page) => !before.has(page));
  for (const page of removed) differences.push({ page, signal: 'route', before: 'present', after: 'MISSING' });
  for (const page of added) differences.push({ page, signal: 'route', before: 'absent', after: 'NEW' });

  let stateBefore = 0;
  let stateAfter = 0;
  for (const [page, beforePath] of before) {
    if (!after.has(page)) continue;
    const beforeHtml = readFileSync(beforePath, 'utf-8');
    const afterHtml = readFileSync(after.get(page), 'utf-8');
    stateBefore += initialStateBytes(beforeHtml);
    stateAfter += initialStateBytes(afterHtml);

    const a = extractSignals(beforeHtml);
    const b = extractSignals(afterHtml);
    for (const signal of Object.keys(a)) {
      const left = JSON.stringify(a[signal]);
      const right = JSON.stringify(b[signal]);
      if (left !== right) differences.push({ page, signal, before: left, after: right });
    }
  }

  for (const file of ['sitemap.xml', 'robots.txt']) {
    const read = (dir) => {
      try {
        return readFileSync(join(dir, file), 'utf-8');
      } catch {
        return null;
      }
    };
    if (read(beforeDir) !== read(afterDir)) {
      differences.push({ page: file, signal: 'bytes', before: 'baseline', after: 'CHANGED' });
    }
  }

  return { pages: before.size, stateBefore, stateAfter, differences };
}

function main() {
  const [beforeDir, afterDir] = process.argv.slice(2);
  if (!beforeDir || !afterDir) {
    console.error('Usage: node scripts/diff-ssg-dist.mjs <dist-before> <dist-after>');
    process.exitCode = 2;
    return;
  }

  const { pages, stateBefore, stateAfter, differences } = diffDist(beforeDir, afterDir);
  const clip = (value) => (value.length > 160 ? `${value.slice(0, 160)}… (${value.length} chars)` : value);
  for (const { page, signal, before, after } of differences) {
    console.log(`DIFF ${page} [${signal}]\n   before: ${clip(before)}\n   after:  ${clip(after)}`);
  }

  const drift = stateBefore ? (((stateAfter - stateBefore) / stateBefore) * 100).toFixed(2) : '0.00';
  console.log(`pages compared: ${pages}`);
  console.log(`__INITIAL_STATE__ total: ${stateBefore} -> ${stateAfter} bytes (${drift}%)`);
  if (differences.length > 0) {
    console.log(`FAIL: ${differences.length} difference(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: every page identical on route list, SEO head, structure and text');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
