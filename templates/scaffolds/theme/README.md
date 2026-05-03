# cms-theme-__SLUG__

__DISPLAY_NAME__ theme for [`@koehler8/cms`](https://github.com/koehler8/cms).

## Status

Starter scaffold. Edit [theme.config.js](theme.config.js) to define your palette, typography, surfaces, etc. The bland slate-and-sand defaults are placeholders.

## Activate

After scaffolding (`npx cms-create-theme __SLUG__`), wire it into your site:

```jsonc
// package.json
"dependencies": {
  "cms-theme-__SLUG__": "file:./themes/__SLUG__"
}
```

```js
// vite.config.js
plugins: cms({
  siteDir: './site',
  themes: ['cms-theme-__SLUG__'],
}),
```

```jsonc
// site/content/{baseLocale}/site.json
{
  "theme": "__SLUG__"
}
```

Run `npm install`, then build/preview to see your theme applied.

## Edit

All theming happens in [theme.config.js](theme.config.js). The CMS turns each `tokens.*` block into `--brand-*` / `--theme-*` / `--ui-*` CSS variables under `:root[data-site-theme="__SLUG__"]`, bundled into a sync stylesheet so they apply during the initial paint.

[theme.css](theme.css) is for supplemental rules the manifest doesn't cover (font `@import`s, brand-color aliases, etc.).

## Extracting to a standalone repo

Once the theme stabilises:

1. Copy `themes/__SLUG__/` to a new repo named `cms-theme-__SLUG__/`
2. Rename the `name` in `package.json` to `@koehler8/cms-theme-__SLUG__` and add the standard repo metadata (homepage, bugs, repository) following the pattern of `@koehler8/cms-theme-neon`
3. Publish to GitHub Packages / npm
4. Replace the `file:` dependency in the consuming site with the published version
