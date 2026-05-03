import manifest from './extension.config.json' with { type: 'json' };

// Components contributed by this extension (use lazy dynamic imports so
// Vite splits each into its own chunk). Key by the same module path
// declared in extension.config.json's components[].module.
//
// To add a new component:
//   1. Create components/Foo.vue.
//   2. Add a {name, label, description, module, configKey} entry to
//      extension.config.json's components[] array.
//   3. Add a `'./components/Foo.vue': () => import('./components/Foo.vue')`
//      entry to the map below.
const components = {};

// Optional setup() hook — runs once during app initialization with
// { app, router, pinia, siteData, isClient }. Use it for runtime
// concerns the manifest doesn't cover (e.g. mounting a banner Vue app
// to document.body, registering a Pinia store, etc.). Remove if unused.
//
// async function setup({ app, router, pinia, siteData, isClient }) {
//   // ...
// }

// Optional contentDefaults — a frozen object keyed by `configKey` that
// the resolver merges underneath each component's content. Use it to
// ship sensible defaults so consumer sites only override what they
// want to change. Remove if unused.
//
// import contentDefaults from './content.defaults.json' with { type: 'json' };

export default {
  manifest,
  components,
  // setup,
  // contentDefaults,
};
export { manifest };
