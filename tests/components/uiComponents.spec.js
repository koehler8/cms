import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
// These three are deep-imported by external packages (cms-ext-crypto), so
// they are public API: they must keep mounting without required props.
import SbCard from '../../src/components/ui/SbCard.vue';
import UnitChip from '../../src/components/ui/UnitChip.vue';
import SkeletonPulse from '../../src/components/ui/SkeletonPulse.vue';

describe('ui components (external public API)', () => {
  it('SbCard mounts and renders its default slot', () => {
    const wrapper = mount(SbCard, { slots: { default: '<p>card body</p>' } });
    expect(wrapper.text()).toContain('card body');
  });

  it('UnitChip mounts without props', () => {
    const wrapper = mount(UnitChip);
    expect(wrapper.element).toBeTruthy();
  });

  it('SkeletonPulse mounts without props', () => {
    const wrapper = mount(SkeletonPulse);
    expect(wrapper.element).toBeTruthy();
  });
});
