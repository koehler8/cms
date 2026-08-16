import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { useFocusTrap } from '../../src/composables/useFocusTrap.js';

const TrapHarness = defineComponent({
  props: {
    active: { type: Boolean, default: false },
    withEscape: { type: Boolean, default: false },
  },
  emits: ['escape'],
  setup(props, { emit }) {
    const containerRef = ref(null);
    const firstRef = ref(null);
    useFocusTrap(containerRef, () => props.active, {
      initialFocusRef: firstRef,
      onEscape: props.withEscape ? () => emit('escape') : null,
    });
    return { containerRef, firstRef };
  },
  template: `
    <div ref="containerRef">
      <button ref="firstRef" id="first">First</button>
      <a href="#" id="middle">Middle</a>
      <button id="last">Last</button>
    </div>
  `,
});

const pressKey = (key, init = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('useFocusTrap', () => {
  it('moves focus to the initial-focus element on activation', async () => {
    wrapper = mount(TrapHarness, { props: { active: false }, attachTo: document.body });
    await wrapper.setProps({ active: true });
    await nextTick();
    await nextTick();
    expect(document.activeElement?.id).toBe('first');
  });

  it('wraps Tab from the last focusable to the first', async () => {
    wrapper = mount(TrapHarness, { props: { active: true }, attachTo: document.body });
    await nextTick();
    document.getElementById('last').focus();
    pressKey('Tab');
    expect(document.activeElement?.id).toBe('first');
  });

  it('wraps Shift+Tab from the first focusable to the last', async () => {
    wrapper = mount(TrapHarness, { props: { active: true }, attachTo: document.body });
    await nextTick();
    document.getElementById('first').focus();
    pressKey('Tab', { shiftKey: true });
    expect(document.activeElement?.id).toBe('last');
  });

  it('does nothing while inactive', async () => {
    wrapper = mount(TrapHarness, { props: { active: false }, attachTo: document.body });
    await nextTick();
    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    pressKey('Tab');
    expect(document.activeElement?.id).toBe('outside');
  });

  it('invokes onEscape when provided', async () => {
    wrapper = mount(TrapHarness, { props: { active: true, withEscape: true }, attachTo: document.body });
    await nextTick();
    pressKey('Escape');
    expect(wrapper.emitted('escape')).toHaveLength(1);
  });

  it('ignores Escape when no handler is provided (non-dismissible gates)', async () => {
    wrapper = mount(TrapHarness, { props: { active: true }, attachTo: document.body });
    await nextTick();
    expect(() => pressKey('Escape')).not.toThrow();
  });

  it('restores focus to the previously focused element on deactivation', async () => {
    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    outside.focus();

    wrapper = mount(TrapHarness, { props: { active: false }, attachTo: document.body });
    await wrapper.setProps({ active: true });
    await nextTick();
    await nextTick();
    expect(document.activeElement?.id).toBe('first');

    await wrapper.setProps({ active: false });
    await nextTick();
    expect(document.activeElement?.id).toBe('outside');
  });
});
