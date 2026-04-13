<template>
  <span class="unit-chip">
    <span v-if="icon" class="unit-chip__icon">
      <img :src="icon" :alt="iconAlt" />
    </span>
    <span class="unit-chip__label">{{ label }}</span>
  </span>
</template>

<script setup>
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
    default: '',
  },
  iconAlt: {
    type: String,
    default: 'Token icon',
  },
});
</script>

<style scoped>
.unit-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  min-height: 24px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand-fg-200);
  background: var(--brand-bg-800);
  border: 1px solid var(--brand-surface-card-border);
  line-height: 1;
  vertical-align: baseline;
  white-space: nowrap;
}

.unit-chip__icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.unit-chip__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.unit-chip__label {
  display: inline-block;
}
</style>
