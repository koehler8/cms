import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import Contact from '../../src/components/Contact.vue';

vi.mock('../../src/utils/analytics.js', () => ({ trackEvent: vi.fn() }));

const mountContact = (contact) =>
  mount(Contact, {
    global: { provide: { pageContent: ref({ contact }) } },
    attachTo: document.body,
  });

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Contact', () => {
  it('renders nothing without a content.contact block', () => {
    wrapper = mount(Contact, { global: { provide: { pageContent: ref({}) } } });
    expect(wrapper.find('section').exists()).toBe(false);
  });

  it('disables submission and says so when no form action is configured', () => {
    wrapper = mountContact({ title: 'Reach us' });
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain("isn't accepting messages");
  });

  it('enables submission with a configured action and generates the challenge only after mount', async () => {
    wrapper = mountContact({ form: { action: 'https://docs.google.com/forms/d/e/x/formResponse' } });
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    await nextTick();
    // Challenge appears post-mount (SSR and client would otherwise generate
    // different random questions — a guaranteed hydration mismatch).
    expect(wrapper.get('#contact-challenge-prompt').text().length).toBeGreaterThan(0);
  });

  it('rejects a wrong challenge answer without posting, announcing via the single live region', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    wrapper = mountContact({ form: { action: 'https://example.com/formResponse' } });
    await nextTick();
    await wrapper.get('#contact-challenge').setValue('definitely-wrong');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wrapper.get('#msg').text()).toContain('spam check');
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('keeps typed input and reports the error when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    wrapper = mountContact({ form: { action: 'https://example.com/formResponse' } });
    await nextTick();
    // Answer the freshly generated challenge by reading the component state.
    const question = wrapper.get('#contact-challenge-prompt').text();
    // Solve generically: extract via the exposed strategy is private — use
    // the arithmetic-only config to make answers computable.
    wrapper.unmount();
    wrapper = mountContact({
      form: {
        action: 'https://example.com/formResponse',
        challenge: { types: ['arithmetic'], template: '{a} {op} {b}' },
      },
    });
    await nextTick();
    const q = wrapper.get('#contact-challenge-prompt').text();
    const m = q.match(/(\d+)\s*([+×-])\s*(\d+)/);
    expect(m).toBeTruthy();
    const [, a, op, b] = m;
    const answer = op === '+' ? +a + +b : op === '-' ? +a - +b : +a * +b;

    await wrapper.get('#contact-name').setValue('Chris');
    await wrapper.get('#contact-email').setValue('c@example.com');
    await wrapper.get('#contact-message').setValue('Hello there');
    await wrapper.get('#contact-challenge').setValue(String(answer));
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('#msg').text()).toContain('something went wrong');
    // The visitor's message survives the failure.
    expect(wrapper.get('#contact-message').element.value).toBe('Hello there');
  });

  it('posts via no-cors and resets on success', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchSpy);
    wrapper = mountContact({
      form: {
        action: 'https://example.com/formResponse',
        challenge: { types: ['arithmetic'], template: '{a} {op} {b}' },
      },
    });
    await nextTick();
    const q = wrapper.get('#contact-challenge-prompt').text();
    const [, a, op, b] = q.match(/(\d+)\s*([+×-])\s*(\d+)/);
    const answer = op === '+' ? +a + +b : op === '-' ? +a - +b : +a * +b;

    await wrapper.get('#contact-name').setValue('Chris');
    await wrapper.get('#contact-email').setValue('c@example.com');
    await wrapper.get('#contact-message').setValue('Hi');
    await wrapper.get('#contact-challenge').setValue(String(answer));
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/formResponse',
      expect.objectContaining({ method: 'POST', mode: 'no-cors' }),
    );
    expect(wrapper.get('#msg').text().length).toBeGreaterThan(0);
    expect(wrapper.get('#contact-message').element.value).toBe('');
  });
});
