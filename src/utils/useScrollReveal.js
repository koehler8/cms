let observer;

function ensureObserver() {
  if (observer || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return observer;
  }

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-observed', 'true');
          observer?.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.2,
      rootMargin: '0px 0px -5% 0px',
    }
  );

  return observer;
}

export function registerScrollReveal(elements) {
  if (!elements) return;
  let targets = [];
  if (Array.isArray(elements)) {
    targets = elements;
  } else if (typeof elements[Symbol.iterator] === 'function' && typeof elements !== 'string') {
    targets = Array.from(elements);
  } else {
    targets = [elements];
  }

  const io = ensureObserver();
  if (!io) {
    targets.forEach((el) => el && el.setAttribute('data-observed', 'true'));
    return;
  }

  targets.forEach((el) => {
    if (!el || el.dataset.observed === 'true') return;
    el.setAttribute('data-observed', 'false');
    io.observe(el);
  });
}
