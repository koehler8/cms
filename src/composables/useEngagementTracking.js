import { onMounted, onBeforeUnmount } from 'vue';
import { trackEvent } from '../utils/analytics.js';

export function useEngagementTracking(options = {}) {
  const isClient = typeof window !== 'undefined' && !import.meta.env.SSR;
  if (!isClient) {
    return {
      refreshVisibilityTargets: () => {},
      resetEngagementTracking: () => {},
    };
  }

  const scrollMilestones = Array.isArray(options.scrollMilestones)
    ? options.scrollMilestones.slice().sort((a, b) => a - b)
    : [25, 50, 75, 90, 100];
  const sectionSelector = options.sectionSelector || '[data-analytics-section]';
  const sectionThreshold = typeof options.sectionThreshold === 'number'
    ? Math.min(Math.max(options.sectionThreshold, 0), 1)
    : 0.5;
  const getContext = typeof options.getContext === 'function'
    ? options.getContext
    : () => ({});

  let firedScrollMilestones = new Set();
  let highestScrollPercent = 0;
  let scrollListenerAttached = false;
  let ticking = false;
  let observer = null;
  let observerReady = false;
  let isMounted = false;
  const seenSections = new Set();

  function buildPayload(extra = {}) {
    return {
      page_path: window.location?.pathname || '',
      ...getContext(),
      ...extra,
    };
  }

  function evaluateScrollDepth() {
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
    const viewportHeight = window.innerHeight || doc.clientHeight || body.clientHeight || 0;
    const docHeight = Math.max(
      body.scrollHeight,
      doc.scrollHeight,
      body.offsetHeight,
      doc.offsetHeight,
      body.clientHeight,
      doc.clientHeight
    );

    if (!docHeight) {
      return;
    }

    const pixelsViewed = Math.min(scrollTop + viewportHeight, docHeight);
    const percentViewed = Math.round((pixelsViewed / docHeight) * 100);

    if (percentViewed <= highestScrollPercent) {
      return;
    }

    highestScrollPercent = percentViewed;

    for (const milestone of scrollMilestones) {
      if (!firedScrollMilestones.has(milestone) && percentViewed >= milestone) {
        firedScrollMilestones.add(milestone);
        trackEvent('engagement_scroll_depth', buildPayload({ depth_percent: milestone }));
      }
    }
  }

  function handleScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      evaluateScrollDepth();
    });
  }

  function initScrollTracking() {
    if (scrollListenerAttached) return;
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    scrollListenerAttached = true;
    evaluateScrollDepth();
  }

  function stopScrollTracking() {
    if (!scrollListenerAttached) return;
    window.removeEventListener('scroll', handleScroll);
    window.removeEventListener('resize', handleScroll);
    scrollListenerAttached = false;
  }

  function getSectionName(element, index) {
    return (
      element.dataset.analyticsSection ||
      element.id ||
      element.getAttribute('aria-label') ||
      `section_${index}`
    );
  }

  function handleVisibilityEntries(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (sectionThreshold && typeof entry.intersectionRatio === 'number' && entry.intersectionRatio < sectionThreshold) {
        continue;
      }
      const name = getSectionName(entry.target, 0);
      if (seenSections.has(name)) continue;
      seenSections.add(name);
      trackEvent('engagement_section_visible', buildPayload({ section: name }));
    }
  }

  function observeSections() {
    if (!isMounted) return;
    const elements = Array.from(document.querySelectorAll(sectionSelector));

    if (!elements.length) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      elements.forEach((el, index) => {
        const name = getSectionName(el, index);
        if (seenSections.has(name)) return;
        seenSections.add(name);
        trackEvent('engagement_section_visible', buildPayload({ section: name, observer: 'fallback' }));
      });
      return;
    }

    if (!observerReady) {
      observer = new IntersectionObserver(handleVisibilityEntries, {
        threshold: [sectionThreshold || 0],
        rootMargin: '0px 0px -10% 0px',
      });
      observerReady = true;
    }

    observer.disconnect();
    elements.forEach((el) => observer.observe(el));
  }

  function refreshVisibilityTargets() {
    if (!isMounted) return;
    observeSections();
  }

  function resetEngagementTracking() {
    firedScrollMilestones = new Set();
    highestScrollPercent = 0;
    seenSections.clear();
    observeSections();
    evaluateScrollDepth();
  }

  onMounted(() => {
    isMounted = true;
    initScrollTracking();
    observeSections();
  });

  onBeforeUnmount(() => {
    isMounted = false;
    stopScrollTracking();
    if (observer && observerReady) {
      observer.disconnect();
      observer = null;
      observerReady = false;
    }
    firedScrollMilestones.clear();
    seenSections.clear();
  });

  return {
    refreshVisibilityTargets,
    resetEngagementTracking,
  };
}
