import cms from '@koehler8/cms/vite';

export default {
  plugins: cms({
    siteDir: './site',
    // Add local themes (created via `npx cms-create-theme <slug>`) here:
    //   themes: ['cms-theme-<slug>'],
    // Then activate by setting `"theme": "<slug>"` in site.json.
    extensions: [
      '@koehler8/cms-ext-compliance',
      // Add local extensions (created via `npx cms-create-extension <slug>`) here:
      //   'cms-ext-<slug>',
    ],
  }),
};
