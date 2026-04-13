export function createSiteStyleLoader(styleModules) {
  let loaded = false;
  let loadPromise;

  function ensureSiteStylesLoaded() {
    if (loadPromise) return loadPromise;

    const keys = Object.keys(styleModules);
    if (!keys.length) {
      loadPromise = Promise.resolve(false);
      return loadPromise;
    }

    // Single site = single style module
    const loader = styleModules[keys[0]];
    loadPromise = Promise.resolve(loader())
      .then(() => {
        loaded = true;
        return true;
      })
      .catch((error) => {
        console.warn('[site-styles] Failed to load site CSS:', error);
        return false;
      });

    return loadPromise;
  }

  return { ensureSiteStylesLoaded };
}

// ---- Runtime singleton ----
let _ensureSiteStylesLoaded = () => Promise.resolve(false);

export function setSiteStyleLoader(instance) {
  if (!instance) return;
  _ensureSiteStylesLoaded = instance.ensureSiteStylesLoaded;
}

export const ensureSiteStylesLoaded = (...args) => _ensureSiteStylesLoaded(...args);
