#!/usr/bin/env node
/**
 * Migration script: converts site/config/ structure to site/content/ structure.
 *
 * Old layout:
 *   site/config/site.json          (nested)
 *   site/config/shared.json        (nested)
 *   site/config/pages/*.json       (nested)
 *   site/config/i18n/{locale}.json (flat dot-notation)
 *
 * New layout:
 *   site/content/content.config.json  ({ "baseLocale": "en" })
 *   site/content/en/site.json         (flat dot-notation, sorted)
 *   site/content/en/shared.json       (flat dot-notation, sorted)
 *   site/content/en/pages/*.json      (flat dot-notation, sorted)
 *   site/content/{locale}/site.json   (flat dot-notation, sorted, overrides only)
 *   site/content/{locale}/shared.json
 *   site/content/{locale}/pages/*.json
 *
 * Usage:
 *   node scripts/migrate-to-content-dirs.mjs /path/to/site-repo
 *   node scripts/migrate-to-content-dirs.mjs /path/to/site-repo --commit
 *
 * Without --commit, runs in dry-run mode (prints what it would do).
 */

import fs from 'node:fs';
import path from 'node:path';

// ---- Flatten utility ----

const ARRAY_INDEX_RE = /\[(\d+)]/g;

function flattenObject(obj, prefix = '') {
  const result = {};
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          Object.assign(result, flattenObject(item, `${fullKey}[${idx}]`));
        } else {
          result[`${fullKey}[${idx}]`] = item;
        }
      });
    } else if (value && typeof value === 'object') {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function sortedJson(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted, null, 2) + '\n';
}

// ---- Main ----

const siteRepoDir = process.argv[2];
const commit = process.argv.includes('--commit');

if (!siteRepoDir) {
  console.error('Usage: node scripts/migrate-to-content-dirs.mjs /path/to/site-repo [--commit]');
  process.exit(1);
}

const siteDir = path.join(siteRepoDir, 'site');
const configDir = path.join(siteDir, 'config');
const contentDir = path.join(siteDir, 'content');

if (!fs.existsSync(configDir)) {
  console.error(`Config directory not found: ${configDir}`);
  process.exit(1);
}

const actions = [];

function plan(action, detail) {
  actions.push({ action, detail });
  if (!commit) console.log(`  [dry-run] ${action}: ${detail}`);
}

// 1. Flatten and move English base files
const enDir = path.join(contentDir, 'en');
const enPagesDir = path.join(enDir, 'pages');

// site.json
const siteJsonPath = path.join(configDir, 'site.json');
if (fs.existsSync(siteJsonPath)) {
  const nested = JSON.parse(fs.readFileSync(siteJsonPath, 'utf-8'));
  const flat = flattenObject(nested);
  plan('write', `content/en/site.json (${Object.keys(flat).length} keys)`);
  if (commit) {
    fs.mkdirSync(enDir, { recursive: true });
    fs.writeFileSync(path.join(enDir, 'site.json'), sortedJson(flat));
  }
}

// shared.json
const sharedJsonPath = path.join(configDir, 'shared.json');
if (fs.existsSync(sharedJsonPath)) {
  const nested = JSON.parse(fs.readFileSync(sharedJsonPath, 'utf-8'));
  const flat = flattenObject(nested);
  plan('write', `content/en/shared.json (${Object.keys(flat).length} keys)`);
  if (commit) {
    fs.mkdirSync(enDir, { recursive: true });
    fs.writeFileSync(path.join(enDir, 'shared.json'), sortedJson(flat));
  }
}

// pages/*.json
const pagesDir = path.join(configDir, 'pages');
if (fs.existsSync(pagesDir)) {
  for (const file of fs.readdirSync(pagesDir)) {
    if (!file.endsWith('.json')) continue;
    const nested = JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf-8'));
    const flat = flattenObject(nested);
    plan('write', `content/en/pages/${file} (${Object.keys(flat).length} keys)`);
    if (commit) {
      fs.mkdirSync(enPagesDir, { recursive: true });
      fs.writeFileSync(path.join(enPagesDir, file), sortedJson(flat));
    }
  }
}

// 2. Split i18n flat files into locale directories
const i18nDir = path.join(configDir, 'i18n');
if (fs.existsSync(i18nDir)) {
  // Read page filenames from config/pages/ to know valid page scopes
  const pageFiles = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    : [];

  for (const file of fs.readdirSync(i18nDir)) {
    if (!file.endsWith('.json')) continue;
    const locale = file.replace('.json', '');
    const localeDir = path.join(contentDir, locale);
    const localePagesDir = path.join(localeDir, 'pages');

    const raw = JSON.parse(fs.readFileSync(path.join(i18nDir, file), 'utf-8'));

    // Buckets: site.*, shared.*, pages.{pageId}.*
    const siteBucket = {};
    const sharedBucket = {};
    const pageBuckets = {};

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('$')) continue;

      if (key.startsWith('site.')) {
        siteBucket[key.slice('site.'.length)] = value;
      } else if (key.startsWith('shared.')) {
        sharedBucket[key.slice('shared.'.length)] = value;
      } else if (key.startsWith('pages.')) {
        const rest = key.slice('pages.'.length);
        const dotIdx = rest.indexOf('.');
        if (dotIdx === -1) continue;
        const pageId = rest.slice(0, dotIdx);
        const pageKey = rest.slice(dotIdx + 1);
        if (!pageBuckets[pageId]) pageBuckets[pageId] = {};
        pageBuckets[pageId][pageKey] = value;
      }
    }

    if (Object.keys(siteBucket).length > 0) {
      plan('write', `content/${locale}/site.json (${Object.keys(siteBucket).length} keys)`);
      if (commit) {
        fs.mkdirSync(localeDir, { recursive: true });
        fs.writeFileSync(path.join(localeDir, 'site.json'), sortedJson(siteBucket));
      }
    }

    if (Object.keys(sharedBucket).length > 0) {
      plan('write', `content/${locale}/shared.json (${Object.keys(sharedBucket).length} keys)`);
      if (commit) {
        fs.mkdirSync(localeDir, { recursive: true });
        fs.writeFileSync(path.join(localeDir, 'shared.json'), sortedJson(sharedBucket));
      }
    }

    for (const [pageId, pageData] of Object.entries(pageBuckets)) {
      if (Object.keys(pageData).length === 0) continue;
      plan('write', `content/${locale}/pages/${pageId}.json (${Object.keys(pageData).length} keys)`);
      if (commit) {
        fs.mkdirSync(localePagesDir, { recursive: true });
        fs.writeFileSync(path.join(localePagesDir, `${pageId}.json`), sortedJson(pageData));
      }
    }
  }
}

// 3. Create content.config.json
plan('write', 'content/content.config.json');
if (commit) {
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentDir, 'content.config.json'),
    JSON.stringify({ baseLocale: 'en' }, null, 2) + '\n'
  );
}

// 4. Remove old config directory
if (commit) {
  fs.rmSync(configDir, { recursive: true, force: true });
  plan('remove', 'config/ directory');
} else {
  plan('remove', 'config/ directory (would be removed)');
}

console.log(`\n${commit ? 'Migration complete' : 'Dry run complete'}. ${actions.length} actions.`);
if (!commit) {
  console.log('Run with --commit to apply changes.');
}
