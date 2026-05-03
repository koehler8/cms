import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runScaffold } from '../../scripts/scaffold.mjs';
import { validateThemeManifest } from '../../src/themes/themeValidator.js';

// Use a temp dir INSIDE the project root rather than os.tmpdir() — Vite's
// dynamic-import resolver refuses to load modules from arbitrary paths
// outside the project (we use dynamic import in one test below to verify
// the generated theme.config.js parses + validates).
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP_PARENT = path.join(PROJECT_ROOT, 'tests', '_tmp');

let tempDir;

beforeEach(async () => {
  await rm(TMP_PARENT, { recursive: true, force: true });
  tempDir = await mkdtemp(path.join(TMP_PARENT, 'scaffold-')).catch(async (err) => {
    // mkdtemp needs the parent to exist
    if (err.code === 'ENOENT') {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(TMP_PARENT, { recursive: true });
      return mkdtemp(path.join(TMP_PARENT, 'scaffold-'));
    }
    throw err;
  });
});

afterEach(async () => {
  await rm(TMP_PARENT, { recursive: true, force: true });
});

describe('runScaffold (theme)', () => {
  it('creates the canonical theme files under themes/<slug>/', async () => {
    const result = await runScaffold({ kind: 'theme', argv: ['coastal'], cwd: tempDir });
    expect(result.ok).toBe(true);
    expect(result.slug).toBe('coastal');
    const dir = path.join(tempDir, 'themes', 'coastal');
    for (const file of ['package.json', 'index.js', 'theme.config.js', 'theme.css', 'README.md']) {
      const stats = await stat(path.join(dir, file));
      expect(stats.isFile()).toBe(true);
    }
  });

  it('substitutes __SLUG__ and __DISPLAY_NAME__ throughout the templates', async () => {
    const result = await runScaffold({ kind: 'theme', argv: ['lush-canopy'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const dir = path.join(tempDir, 'themes', 'lush-canopy');

    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('cms-theme-lush-canopy');
    expect(pkg.description).toContain('Lush Canopy');

    const themeCss = await readFile(path.join(dir, 'theme.css'), 'utf8');
    expect(themeCss).toContain(':root[data-site-theme="lush-canopy"]');
    expect(themeCss).not.toContain('__SLUG__');
    expect(themeCss).not.toContain('__DISPLAY_NAME__');
  });

  it('produces a theme.config.js whose default export validates against the schema', async () => {
    const result = await runScaffold({ kind: 'theme', argv: ['testbed'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const configPath = path.join(tempDir, 'themes', 'testbed', 'theme.config.js');
    const mod = await import(pathToFileURL(configPath).href);
    const manifest = mod.default || mod.manifest || mod;
    expect(() => validateThemeManifest(manifest)).not.toThrow();
    expect(manifest.slug).toBe('testbed');
    expect(manifest.tokens.palette.primary).toBeDefined();
    expect(manifest.tokens.utility.bodyBackground).toBeDefined();
  });

  it('prints next-steps wiring instructions in the success message', async () => {
    const result = await runScaffold({ kind: 'theme', argv: ['coastal'], cwd: tempDir });
    expect(result.message).toContain('cms-theme-coastal');
    expect(result.message).toContain('file:./themes/coastal');
    expect(result.message).toContain("themes: ['cms-theme-coastal']");
    expect(result.message).toContain('"theme": "coastal"');
  });

  it('rejects an existing target without --force', async () => {
    const first = await runScaffold({ kind: 'theme', argv: ['dup'], cwd: tempDir });
    expect(first.ok).toBe(true);
    const second = await runScaffold({ kind: 'theme', argv: ['dup'], cwd: tempDir });
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already exists/);
  });

  it('overwrites with --force', async () => {
    await runScaffold({ kind: 'theme', argv: ['dup'], cwd: tempDir });
    const second = await runScaffold({ kind: 'theme', argv: ['dup', '--force'], cwd: tempDir });
    expect(second.ok).toBe(true);
  });

  it('honors --out for a custom target directory', async () => {
    const result = await runScaffold({
      kind: 'theme',
      argv: ['coastal', '--out', 'custom/path'],
      cwd: tempDir,
    });
    expect(result.ok).toBe(true);
    const stats = await stat(path.join(tempDir, 'custom', 'path', 'package.json'));
    expect(stats.isFile()).toBe(true);
  });

  it('rejects non-kebab-case slugs', async () => {
    const r1 = await runScaffold({ kind: 'theme', argv: ['CoastalCollective'], cwd: tempDir });
    expect(r1.ok).toBe(false);
    expect(r1.message).toMatch(/kebab-case/);

    const r2 = await runScaffold({ kind: 'theme', argv: ['has spaces'], cwd: tempDir });
    expect(r2.ok).toBe(false);
  });

  it('reports missing slug usefully', async () => {
    const result = await runScaffold({ kind: 'theme', argv: [], cwd: tempDir });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/missing <slug>/);
    expect(result.message).toMatch(/Usage:/);
  });
});

describe('runScaffold (extension)', () => {
  it('creates the canonical extension files under extensions/<slug>/', async () => {
    const result = await runScaffold({ kind: 'extension', argv: ['realestate'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const dir = path.join(tempDir, 'extensions', 'realestate');
    for (const file of ['package.json', 'extension.config.json', 'index.js', 'README.md']) {
      const stats = await stat(path.join(dir, file));
      expect(stats.isFile()).toBe(true);
    }
  });

  it('uses cms-ext-<slug> for the package name and components: [] in the manifest', async () => {
    const result = await runScaffold({ kind: 'extension', argv: ['realestate'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const dir = path.join(tempDir, 'extensions', 'realestate');

    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('cms-ext-realestate');

    const cfg = JSON.parse(await readFile(path.join(dir, 'extension.config.json'), 'utf8'));
    expect(cfg.slug).toBe('realestate');
    expect(cfg.components).toEqual([]);
  });

  it('prints extension-flavoured next-steps wiring instructions', async () => {
    const result = await runScaffold({ kind: 'extension', argv: ['realestate'], cwd: tempDir });
    expect(result.message).toContain('cms-ext-realestate');
    expect(result.message).toContain('file:./extensions/realestate');
    expect(result.message).toContain("extensions: ['cms-ext-realestate']");
    // and reminds devs to prefer site/components for one-offs
    expect(result.message).toContain('site/components/');
  });
});

describe('runScaffold (site)', () => {
  it('creates the canonical site files under site-<slug>/', async () => {
    const result = await runScaffold({ kind: 'site', argv: ['demo'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const dir = path.join(tempDir, 'site-demo');
    for (const file of [
      'package.json', 'vite.config.js', 'amplify.yml', '.nvmrc', '.gitignore',
      '.env.example', 'README.md', 'CLAUDE.md',
      'site/content/content.config.json',
      'site/content/en/site.json',
      'site/content/en/shared.json',
      'site/content/en/pages/home.json',
      'site/style.css',
    ]) {
      const stats = await stat(path.join(dir, file));
      expect(stats.isFile()).toBe(true);
    }
  });

  it('uses @koehler8/site-<slug> for the package name and applies display-name substitution', async () => {
    const result = await runScaffold({ kind: 'site', argv: ['orange-county'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const dir = path.join(tempDir, 'site-orange-county');

    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@koehler8/site-orange-county');
    expect(pkg.dependencies['@koehler8/cms']).toMatch(/beta/);
    expect(pkg.engines.node).toMatch(/20\.19/);

    const siteJson = JSON.parse(await readFile(path.join(dir, 'site/content/en/site.json'), 'utf8'));
    expect(siteJson.title).toBe('Orange County');

    const shared = JSON.parse(await readFile(path.join(dir, 'site/content/en/shared.json'), 'utf8'));
    expect(shared['content.header.logoText']).toBe('Orange County');
  });

  it('CLAUDE.md template substitutes slug and includes the where-things-go guide', async () => {
    const result = await runScaffold({ kind: 'site', argv: ['demo'], cwd: tempDir });
    expect(result.ok).toBe(true);
    const claude = await readFile(path.join(tempDir, 'site-demo', 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('# site-demo');
    expect(claude).toContain('Where things go');
    expect(claude).toContain('site/content/{locale}/pages/');
    expect(claude).toContain('site/components/Foo.vue');
    expect(claude).toContain('npx cms-create-theme');
    expect(claude).toContain('npx cms-create-extension');
    expect(claude).not.toContain('__SLUG__');
    expect(claude).not.toContain('__DISPLAY_NAME__');
  });

  it('prints site-flavoured next-steps including a CLAUDE.md pointer', async () => {
    const result = await runScaffold({ kind: 'site', argv: ['demo'], cwd: tempDir });
    expect(result.message).toContain('cd site-demo');
    expect(result.message).toContain('nvm use && npm install');
    expect(result.message).toContain('Read CLAUDE.md');
    expect(result.message).toContain('cms-create-theme');
    expect(result.message).toContain('cms-create-extension');
  });
});
