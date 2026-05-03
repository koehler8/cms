# cms-ext-__SLUG__

__DISPLAY_NAME__ extension for [`@koehler8/cms`](https://github.com/koehler8/cms).

## Status

Starter scaffold. Currently empty (`components: []`). Add components as the design takes shape.

## Activate

After scaffolding (`npx cms-create-extension __SLUG__`), wire it into your site:

```jsonc
// package.json
"dependencies": {
  "cms-ext-__SLUG__": "file:./extensions/__SLUG__"
}
```

```js
// vite.config.js
plugins: cms({
  siteDir: './site',
  extensions: ['cms-ext-__SLUG__'],
}),
```

Run `npm install`, then build/preview.

## Add a component

1. Create `components/Foo.vue`. Follow the standard CMS pattern:
   - Read content via `inject('pageContent')`
   - Use `<style scoped>`
   - Consume theme tokens via `var(--brand-*)`
2. Add an entry to [extension.config.json](extension.config.json) `components[]` — `name`, `label`, `description`, `module`, `configKey`.
3. Add a lazy dynamic import to [index.js](index.js)'s `components` map keyed by the same module path.
4. Reference the component by name in any page's `components[]` array (e.g. `"components[N]": "Foo"`).
5. Put translations under `content.{configKey}.*` in `pages/{pageId}.json`.

## When to put a component here vs `site/components/`

- **`site/components/`** — one-off components specific to a single site. Auto-globbed; no extension wrapper needed. **Default.**
- **This extension** — components destined to be shared across multiple sites (e.g. eventually published to npm).

## Extracting to a standalone repo

Once the extension carries enough to be worth sharing:

1. Copy `extensions/__SLUG__/` to a new repo named `cms-ext-__SLUG__/`
2. Rename `name` in `package.json` to `@koehler8/cms-ext-__SLUG__` and add the standard repo metadata (homepage, bugs, repository) following the pattern of `@koehler8/cms-ext-compliance`
3. Publish to GitHub Packages / npm
4. Replace the `file:` dependency in each consuming site with the published version
