/**
 * Global test setup — mocks for browser APIs not provided by happy-dom.
 */

// IntersectionObserver stub
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(callback) {
      this._callback = callback;
      this._elements = new Set();
    }
    observe(el) { this._elements.add(el); }
    unobserve(el) { this._elements.delete(el); }
    disconnect() { this._elements.clear(); }
    /** Test helper: simulate entries becoming visible */
    _trigger(entries) { this._callback(entries, this); }
  };
}

// requestIdleCallback stub
if (typeof globalThis.requestIdleCallback === 'undefined') {
  globalThis.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 50 }), 0);
  globalThis.cancelIdleCallback = (id) => clearTimeout(id);
}
