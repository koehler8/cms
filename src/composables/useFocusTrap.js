import { nextTick, onBeforeUnmount, unref, watch } from 'vue';

// Selector shared by every modal in the framework. Kept intentionally simple:
// visible-but-disabled edge cases are handled by the browser refusing focus.
export const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus containment for modal dialogs (WCAG 2.4.3 Focus Order).
 *
 * While `active` is truthy:
 *   - Tab / Shift+Tab wrap within `containerRef`.
 *   - Escape calls `options.onEscape` when provided (omit it for gates that
 *     must not be dismissible, e.g. the draft password gate).
 * On activation, focus moves to `options.initialFocusRef` (or the container);
 * on deactivation, focus returns to the element focused before.
 *
 * `active` may be a ref or a getter. SSR-safe: does nothing on the server.
 */
export function useFocusTrap(containerRef, active, options = {}) {
  const { initialFocusRef = null, onEscape = null } = options;

  let previousFocused = null;

  const isActive = () => Boolean(typeof active === 'function' ? active() : unref(active));

  const handleKeydown = (event) => {
    if (!isActive()) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
      if (typeof onEscape === 'function') {
        event.preventDefault();
        onEscape();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const container = unref(containerRef);
    if (!container) return;
    const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const activate = () => {
    previousFocused =
      typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    nextTick(() => {
      const target = unref(initialFocusRef) || unref(containerRef);
      if (target && typeof target.focus === 'function') target.focus();
    });
    document.addEventListener('keydown', handleKeydown);
  };

  const deactivate = () => {
    document.removeEventListener('keydown', handleKeydown);
    if (previousFocused && typeof previousFocused.focus === 'function') {
      previousFocused.focus();
    }
    previousFocused = null;
  };

  if (!import.meta.env.SSR) {
    watch(isActive, (open, wasOpen) => {
      if (open && !wasOpen) activate();
      else if (!open && wasOpen) deactivate();
    }, { immediate: true });

    onBeforeUnmount(() => {
      document.removeEventListener('keydown', handleKeydown);
    });
  }
}
