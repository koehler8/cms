// Framework version as seen by the runtime (used by useComponentResolver's
// minAppVersion checks and available to extensions).
//
// The Vite plugin defines import.meta.env.VITE_APP_VERSION at build time
// (framework package.json version, overridable by a real VITE_APP_VERSION
// env var), so no package.json bytes ship in the bundle. Outside the plugin
// (bare unit tests) the fallback is '0.0.0'.
const envVersion = import.meta?.env?.VITE_APP_VERSION;

export const APP_VERSION = (typeof envVersion === 'string' && envVersion.trim())
  ? envVersion.trim()
  : '0.0.0';
