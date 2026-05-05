import { onServerPrefetch, ref, watch } from 'vue';
import { loadConfigData, mergeConfigTrees } from '../utils/loadConfig.js';

function normalizePath(value) {
  if (!value || typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/+/g, '/');
  normalized = normalized.replace(/\/+$/, '');
  return normalized || '/';
}

function mergeWithSharedContent(sharedContent, pageSpecificContent) {
  const base = sharedContent && typeof sharedContent === 'object' ? sharedContent : {};
  const overrides = pageSpecificContent && typeof pageSpecificContent === 'object' ? pageSpecificContent : {};
  return mergeConfigTrees(base, overrides, { cloneTarget: true, skipEmpty: true });
}

export function usePageConfig({ pageId, pagePath, locale, onPageLoaded } = {}) {
  const siteData = ref(null);
  const pageContent = ref({});
  const currentPage = ref({
    id: '',
    path: '/',
    components: [],
    content: {},
    meta: {},
    draft: undefined,
  });
  const componentKeys = ref([]);
  const isLoading = ref(false);
  const loadError = ref(null);

  let cachedConfig = null;
  let lastLocaleKey = null;
  let activeRequest = 0;

  function selectPage(config) {
    const pages = config?.pages || {};
    const entries = Object.entries(pages);

    const resolveById = (id) => {
      const data = pages[id];
      if (!data) return null;
      return {
        id,
        path: data.path ?? '/',
        components: Array.isArray(data.components) ? [...data.components] : [],
        content: data.content || {},
        meta: data.meta || {},
        draft: data.draft,
        jsonld: data.jsonld,
      };
    };

    const currentPageId = typeof pageId === 'function' ? pageId() : pageId;
    const currentPagePath = typeof pagePath === 'function' ? pagePath() : pagePath;

    if (currentPageId) {
      const direct = resolveById(currentPageId);
      if (direct) return direct;
    }

    if (currentPagePath) {
      const requestedPath = normalizePath(currentPagePath);
      for (const [id, data] of entries) {
        if (normalizePath(data.path) === requestedPath) {
          return {
            id,
            path: data.path ?? '/',
            components: Array.isArray(data.components) ? [...data.components] : [],
            content: data.content || {},
            meta: data.meta || {},
            draft: data.draft,
            jsonld: data.jsonld,
          };
        }
      }

      // No page matches the requested path. If it's anything other than
      // the home path "/" — or the explicit /404 SSG route — treat it as
      // a not-found page (instead of silently returning home content with
      // HTTP 200, which is what the framework used to do).
      //
      // Sites can override the rendered 404 by authoring pages/404.json
      // with their own components[]; otherwise the synthesized sentinel
      // renders the bundled NotFound component.
      if (requestedPath !== '/') {
        const customNotFound = resolveById('404');
        if (customNotFound) {
          return { ...customNotFound, isNotFound: true };
        }
        return {
          id: '__not_found__',
          path: requestedPath,
          components: [{ name: 'NotFound', enabled: true }],
          content: {},
          meta: {},
          draft: undefined,
          isNotFound: true,
        };
      }
    }

    const homeFallback = resolveById('home');
    if (homeFallback) return homeFallback;

    if (entries.length > 0) {
      const [firstId, firstData] = entries[0];
      return {
        id: firstId,
        path: firstData.path ?? '/',
        components: Array.isArray(firstData.components) ? [...firstData.components] : [],
        content: firstData.content || {},
        meta: firstData.meta || {},
        draft: firstData.draft,
        jsonld: firstData.jsonld,
      };
    }

    return null;
  }

  async function syncPage() {
    const requestId = ++activeRequest;
    const currentLocale = typeof locale === 'function' ? locale() : locale;
    const localeKey = (currentLocale || '').toString().toLowerCase() || 'default';
    const shouldReload = !cachedConfig || lastLocaleKey !== localeKey;
    const localeForConfig = localeKey === 'default' ? undefined : localeKey;

    if (requestId === activeRequest) {
      isLoading.value = true;
      if (shouldReload) {
        componentKeys.value = [];
      }
      loadError.value = null;
    }

    try {
      if (shouldReload) {
        cachedConfig = await loadConfigData({ locale: localeForConfig });
        lastLocaleKey = localeKey;
      }

      if (requestId !== activeRequest) return;

      siteData.value = cachedConfig;
      const selectedPage = selectPage(cachedConfig);

      if (!selectedPage) {
        throw new Error('No pages defined in configuration.');
      }

      const sharedContent = cachedConfig?.shared?.content;
      const mergedContent = mergeWithSharedContent(sharedContent, selectedPage.content);
      currentPage.value = {
        ...selectedPage,
        content: mergedContent,
      };
      pageContent.value = mergedContent;

      if (typeof onPageLoaded === 'function') {
        onPageLoaded({ config: cachedConfig, page: selectedPage, content: mergedContent });
      }

      componentKeys.value = Array.isArray(selectedPage.components)
        ? selectedPage.components.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry))
        : [];
    } catch (error) {
      if (requestId !== activeRequest) return;
      if (import.meta.env.DEV) {
        console.error('[PageRenderer] Failed to load page configuration', error);
      }
      currentPage.value = { id: '', path: '/', components: [], content: {}, meta: {}, draft: undefined };
      pageContent.value = {};
      if (typeof onPageLoaded === 'function') {
        onPageLoaded({ config: null, page: null, content: {} });
      }
      componentKeys.value = [];
      loadError.value = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (requestId === activeRequest) {
        isLoading.value = false;
      }
    }
  }

  if (import.meta.env.SSR) {
    onServerPrefetch(async () => {
      await syncPage();
    });
  } else {
    syncPage();
  }

  const getPageId = typeof pageId === 'function' ? pageId : () => pageId;
  const getPagePath = typeof pagePath === 'function' ? pagePath : () => pagePath;
  const getLocale = typeof locale === 'function' ? locale : () => locale;

  watch(
    () => [getPageId(), getPagePath(), getLocale()],
    () => { syncPage(); },
  );

  return {
    siteData,
    pageContent,
    currentPage,
    componentKeys,
    isLoading,
    loadError,
    syncPage,
  };
}
