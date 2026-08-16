import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import NotFound from '../../src/components/NotFound.vue';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('NotFound', () => {
  it('renders the default 404 content with no injections at all', () => {
    wrapper = mount(NotFound);
    expect(wrapper.get('h1').text()).toBe('Page not found');
    expect(wrapper.get('a').attributes('href')).toBe('/');
  });

  it('merges shared and page overrides (page wins per key)', () => {
    wrapper = mount(NotFound, {
      global: {
        provide: {
          siteData: ref({ shared: { content: { notFound: { heading: 'Shared heading', body: 'Shared body' } } } }),
          pageContent: ref({ notFound: { heading: 'Page heading' } }),
        },
      },
    });
    expect(wrapper.get('h1').text()).toBe('Page heading');
    expect(wrapper.get('.not-found__body').text()).toBe('Shared body');
  });
});
