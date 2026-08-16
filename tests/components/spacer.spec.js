import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Spacer from '../../src/components/Spacer.vue';
import Spacer15 from '../../src/components/Spacer15.vue';
import Spacer60 from '../../src/components/Spacer60.vue';

const sizeOf = (wrapper) => wrapper.get('.ui-spacer').attributes('style');

describe('Spacer', () => {
  it('defaults to 30px', () => {
    expect(sizeOf(mount(Spacer))).toContain('--ui-spacer-size: 30px');
  });

  it('accepts numeric and string sizes', () => {
    expect(sizeOf(mount(Spacer, { props: { size: 15 } }))).toContain('--ui-spacer-size: 15px');
    expect(sizeOf(mount(Spacer, { props: { size: '60' } }))).toContain('--ui-spacer-size: 60px');
  });

  it('falls back to 30px on a nonsense size', () => {
    expect(sizeOf(mount(Spacer, { props: { size: 'huge' } }))).toContain('--ui-spacer-size: 30px');
    expect(sizeOf(mount(Spacer, { props: { size: -5 } }))).toContain('--ui-spacer-size: 30px');
  });

  it('is aria-hidden (purely presentational)', () => {
    expect(mount(Spacer).get('.ui-spacer').attributes('aria-hidden')).toBe('true');
  });

  it('numeric aliases render the generic Spacer with their fixed size', () => {
    expect(sizeOf(mount(Spacer15))).toContain('--ui-spacer-size: 15px');
    expect(sizeOf(mount(Spacer60))).toContain('--ui-spacer-size: 60px');
  });
});
