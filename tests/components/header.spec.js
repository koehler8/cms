import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref, h } from 'vue';

// The route has to be reactive — Header watches route.path to dismiss the
// mobile menu on in-SPA navigation, and watch() can't track a plain object.
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  const route = reactive({ path: '/', params: {} });
  return { useRoute: () => route, __route: route };
});
vi.mock('../../src/utils/assetResolver.js', () => ({ resolveAsset: () => '' }));
vi.mock('../../src/utils/analytics.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../../src/extensions/extensionLoader.js', () => ({ getExtensionComponent: () => null }));
vi.mock('../../src/utils/loadConfig.js', () => ({ availableLocales: ['en'], baseLocale: 'en' }));
vi.mock('../../src/utils/webStorage.js', () => ({
  readStoredLocale: () => 'en',
  writeStoredLocale: vi.fn(),
}));

const Header = (await import('../../src/components/Header.vue')).default;
const { __route: route } = await import('vue-router');

const NAV_ITEMS = [
  { text: 'Docs', href: '/docs' },
  { text: 'Pricing', href: '/pricing' },
  { text: 'GitHub', href: 'https://github.com/example', target: '_blank' },
];

function mountHeader({ navItems = NAV_ITEMS, slots = {} } = {}) {
  return mount(Header, {
    attachTo: document.body,
    slots,
    global: {
      provide: {
        siteData: ref({ site: { title: 'Example' }, header: { navItems } }),
        pageContent: ref({}),
      },
    },
  });
}

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
}

let wrapper;

beforeEach(() => {
  route.path = '/';
  setViewportWidth(375);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('Header — mobile nav disclosure', () => {
  // Before this existed, .site-header__nav-list was plain display:none below
  // 720px with no toggle, so phone visitors had no primary navigation at all.
  it('renders a toggle button wired to the nav list', () => {
    wrapper = mountHeader();
    const toggle = wrapper.get('.site-header__nav-toggle');
    expect(toggle.attributes('aria-controls')).toBe('site-header-nav-menu');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-label')).toBe('Open menu');
    expect(wrapper.get('#site-header-nav-menu').classes()).not.toContain('site-header__nav-list--open');
  });

  it('does not render a toggle when there are no nav items', () => {
    wrapper = mountHeader({ navItems: [] });
    expect(wrapper.find('.site-header__nav-toggle').exists()).toBe(false);
  });

  it('opens and closes on click, keeping aria-expanded and the label in sync', async () => {
    wrapper = mountHeader();
    const toggle = wrapper.get('.site-header__nav-toggle');

    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(toggle.attributes('aria-label')).toBe('Close menu');
    expect(wrapper.get('#site-header-nav-menu').classes()).toContain('site-header__nav-list--open');

    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('#site-header-nav-menu').classes()).not.toContain('site-header__nav-list--open');
  });

  it('renders every nav item as a link, with rel on external targets', async () => {
    wrapper = mountHeader();
    await wrapper.get('.site-header__nav-toggle').trigger('click');

    const links = wrapper.get('#site-header-nav-menu').findAll('a');
    expect(links.map((l) => l.text())).toEqual(['Docs', 'Pricing', 'GitHub']);
    expect(links[2].attributes('target')).toBe('_blank');
    expect(links[2].attributes('rel')).toBe('noopener noreferrer');
  });

  it('closes when a menu link is chosen', async () => {
    wrapper = mountHeader();
    await wrapper.get('.site-header__nav-toggle').trigger('click');

    await wrapper.get('#site-header-nav-menu a').trigger('click');
    expect(wrapper.get('.site-header__nav-toggle').attributes('aria-expanded')).toBe('false');
  });

  it('closes on Escape and restores focus to the toggle (WCAG 2.4.3)', async () => {
    wrapper = mountHeader();
    const toggle = wrapper.get('.site-header__nav-toggle');
    await toggle.trigger('click');

    await wrapper.get('.site-header__nav').trigger('keydown.esc');
    await nextTick();
    await nextTick();

    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle.element);
  });

  it('closes when focus leaves both the menu and the toggle', async () => {
    wrapper = mountHeader();
    await wrapper.get('.site-header__nav-toggle').trigger('click');

    const outside = document.createElement('button');
    document.body.appendChild(outside);

    await wrapper.get('.site-header__nav').trigger('focusout', { relatedTarget: outside });
    expect(wrapper.get('.site-header__nav-toggle').attributes('aria-expanded')).toBe('false');

    outside.remove();
  });

  it('stays open while focus moves between the toggle and its menu', async () => {
    wrapper = mountHeader();
    const toggle = wrapper.get('.site-header__nav-toggle');
    await toggle.trigger('click');

    const firstLink = wrapper.get('#site-header-nav-menu a').element;
    await wrapper.get('.site-header__nav').trigger('focusout', { relatedTarget: firstLink });

    expect(toggle.attributes('aria-expanded')).toBe('true');
  });

  it('closes on an outside document click', async () => {
    wrapper = mountHeader();
    await wrapper.get('.site-header__nav-toggle').trigger('click');

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.get('.site-header__nav-toggle').attributes('aria-expanded')).toBe('false');
  });

  it('closes when the viewport grows past the desktop breakpoint', async () => {
    wrapper = mountHeader();
    await wrapper.get('.site-header__nav-toggle').trigger('click');

    setViewportWidth(1280);
    window.dispatchEvent(new Event('resize'));
    await nextTick();

    // Above 720px the toggle is display:none; leaving it expanded would strand
    // aria-expanded="true" on a control no longer in the accessibility tree.
    expect(wrapper.get('.site-header__nav-toggle').attributes('aria-expanded')).toBe('false');
  });

  it('closes on in-SPA route change', async () => {
    wrapper = mountHeader();
    await wrapper.get('.site-header__nav-toggle').trigger('click');

    route.path = '/pricing';
    await nextTick();

    expect(wrapper.get('.site-header__nav-toggle').attributes('aria-expanded')).toBe('false');
  });

  it('suppresses the bundled toggle when a site overrides the nav slot', () => {
    wrapper = mountHeader({
      slots: { nav: () => h('ul', { class: 'custom-nav' }, [h('li', 'Custom')]) },
    });
    expect(wrapper.find('.custom-nav').exists()).toBe(true);
    // The site owns its own responsive behaviour; two toggles would collide.
    expect(wrapper.find('.site-header__nav-toggle').exists()).toBe(false);
  });
});
