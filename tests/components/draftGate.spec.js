import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DraftGate from '../../src/components/DraftGate.vue';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('DraftGate', () => {
  it('renders a modal dialog with a real label and password input', () => {
    wrapper = mount(DraftGate, { props: { hasPassword: true }, attachTo: document.body });
    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(wrapper.get('label[for="draft-gate-password"]').text()).toContain('Password');
    expect(wrapper.get('input[type="password"]').attributes('autocomplete')).toBe('current-password');
    expect(wrapper.get('button[type="submit"]').text()).toBe('Unlock');
  });

  it('moves focus to the password input on mount (focus trap active)', async () => {
    wrapper = mount(DraftGate, { props: { hasPassword: true }, attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(document.activeElement?.id).toBe('draft-gate-password');
  });

  it('emits submit with the typed password', async () => {
    wrapper = mount(DraftGate, { props: { hasPassword: true }, attachTo: document.body });
    await wrapper.get('input[type="password"]').setValue('hunter2');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toEqual([['hunter2']]);
  });

  it('shows the error message in the live region and flags the input invalid', async () => {
    wrapper = mount(DraftGate, {
      props: { hasPassword: true, errorMessage: 'Incorrect password.' },
      attachTo: document.body,
    });
    expect(wrapper.get('#draft-gate-error').text()).toBe('Incorrect password.');
    expect(wrapper.get('#draft-gate-error').attributes('aria-live')).toBe('polite');
    expect(wrapper.get('input[type="password"]').attributes('aria-invalid')).toBe('true');
  });

  it('offers Continue wording when no password is configured', () => {
    wrapper = mount(DraftGate, { props: { hasPassword: false }, attachTo: document.body });
    expect(wrapper.get('button[type="submit"]').text()).toBe('Continue');
  });
});
