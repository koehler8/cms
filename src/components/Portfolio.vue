<template>
  <section
    id="portfolio"
    class="portfolio-section ui-section ui-section--stacked"
    data-analytics-section="portfolio"
    ref="portfolioSection"
  >
    <div class="container">
      <span id="now"></span>

      <header v-if="sectionTitle || sectionSubtitle" class="section-header text-center">
        <div v-if="sectionTitle" class="section-heading">
          <h2 class="display-heading">{{ sectionTitle }}</h2>
          <span class="section-divider" aria-hidden="true"></span>
        </div>
        <p v-if="sectionSubtitle" class="section-description">{{ sectionSubtitle }}</p>
      </header>

      <div>
      <!-- Start Portfolio Filter -->
      <ul class="portfolio-filters" role="list">
        <li role="listitem">
          <button
            type="button"
            class="portfolio-filter"
            :class="{ 'portfolio-filter--active': activeFilter === '*' }"
            @click="setFilter('*')"
          >
            All
          </button>
        </li>
        <li
          v-for="tag in filters"
          :key="tag"
          role="listitem"
        >
          <button
            type="button"
            class="portfolio-filter"
            :class="{ 'portfolio-filter--active': activeFilter === tag }"
            @click="setFilter(tag)"
          >
            {{ tagLabelMap[tag] }}
          </button>
        </li>
      </ul>
      <!-- End Portfolio Filter -->
      <!-- Start Portfolio Content -->
      <transition-group
        name="portfolio"
        tag="div"
        class="portfolio-grid"
        @after-leave="handleAfterLeave"
      >
        <div
          v-for="(project, idx) in displayedProjects"
          :key="project.key"
          class="portfolio-grid__item"
        >
          <div
            class="portfolio-card ui-card ui-card-surface fade-up-in js-scroll-fade"
            :style="{ '--fade-up-delay': `${Math.min(idx, 4) * 0.06}s` }"
          >
            <div class="portfolio-image-frame">
              <img
                class="portfolio-image"
                :src="getImageSrc(project.img)"
                :alt="project.title"
                loading="lazy"
                decoding="async"
              >
            </div>
            <span class="portfolio-tag ui-label-sm">{{ project.displayTags || project.tags }}</span>
            <h3 class="portfolio-title ui-title-md">{{ project.title }}</h3>
            <a class="portfolio-card__link" :href="project.href" :aria-label="`View ${project.title}`"></a>
          </div>
        </div>
      </transition-group>
      <!-- End Portfolio Content -->
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import { resolveAsset } from '../utils/assetResolver.js';
import { registerScrollReveal } from '../utils/useScrollReveal.js';

const DEFAULT_TITLE = 'Our Ventures';
const DEFAULT_SUBTITLE = 'Explore the companies and products we build across the studio.';

const projects = ref([]);
const portfolioSection = ref(null);
const sectionTitle = ref(DEFAULT_TITLE);
const sectionSubtitle = ref(DEFAULT_SUBTITLE);

const getImageSrc = (img) => {
  if (!img) return '';
  return resolveAsset(`img/portfolio-${img}.png`);
};

const activeFilter = ref('*');
const displayedProjects = ref([]);
const pendingProjects = ref(null);
const leavingCount = ref(0);

const ensureTagData = (project) => {
  if (!project) return { entries: [], normalized: [], labels: '' };
  if (Array.isArray(project.tagEntries) && Array.isArray(project.normalizedTags)) {
    return {
      entries: project.tagEntries,
      normalized: project.normalizedTags,
      labels: project.displayTags || project.tagEntries.map(({ label }) => label).join(', '),
    };
  }
  const tagEntries = parseTagEntries(project.tags);
  const normalizedTags = tagEntries.map(({ key }) => key);
  const displayTags = tagEntries.map(({ label }) => label).join(', ');
  project.tagEntries = tagEntries;
  project.normalizedTags = normalizedTags;
  project.displayTags = displayTags;
  return { entries: tagEntries, normalized: normalizedTags, labels: displayTags };
};

const tagLabelMap = computed(() => {
  const map = {};
  projects.value.forEach((project) => {
    const { entries } = ensureTagData(project);
    entries.forEach(({ key, label }) => {
      if (key && label && !map[key]) {
        map[key] = label;
      }
    });
  });
  return map;
});

const filters = computed(() => Object.keys(tagLabelMap.value));

const filteredProjects = computed(() => {
  const filter = activeFilter.value;
  if (filter === '*' || !filter) {
    return projects.value;
  }
  return projects.value.filter((project) => {
    const { normalized } = ensureTagData(project);
    if (!normalized.length) return false;
    return normalized.includes(filter);
  });
});

const pageContent = inject('pageContent', ref({}));

function parseTagEntries(tags) {
  const entries = [];
  if (Array.isArray(tags)) {
    tags.forEach((tag) => {
      if (typeof tag !== 'string') return;
      const label = tag.trim();
      const key = label.toLowerCase().replace(/\s+/g, '-');
      if (key) {
        entries.push({ key, label: label || key });
      }
    });
    return entries;
  }
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((label) => ({
        key: label.toLowerCase().replace(/\s+/g, '-'),
        label,
      }));
  }
  return entries;
}

function applyPortfolio(content = {}) {
  const portfolioConfig = content?.portfolio;
  let titleSet = false;
  let subtitleSet = false;

  sectionTitle.value = DEFAULT_TITLE;
  sectionSubtitle.value = DEFAULT_SUBTITLE;

  if (Array.isArray(portfolioConfig)) {
    projects.value = portfolioConfig.map((project, index) => buildProjectRecord(project, index));
  } else if (portfolioConfig && typeof portfolioConfig === 'object') {
    if (Object.prototype.hasOwnProperty.call(portfolioConfig, 'title')) {
      sectionTitle.value = portfolioConfig.title || '';
      titleSet = true;
    }
    if (Object.prototype.hasOwnProperty.call(portfolioConfig, 'subtitle')) {
      sectionSubtitle.value = portfolioConfig.subtitle || '';
      subtitleSet = true;
    }
    projects.value = Array.isArray(portfolioConfig.items)
      ? portfolioConfig.items.map((project, index) => buildProjectRecord(project, index))
      : [];
  } else {
    projects.value = [];
  }

  if (Object.prototype.hasOwnProperty.call(content, 'portfolioTitle')) {
    sectionTitle.value = content.portfolioTitle || '';
    titleSet = true;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'portfolioSubtitle')) {
    sectionSubtitle.value = content.portfolioSubtitle || '';
    subtitleSet = true;
  }

  if (!titleSet && content?.about?.topButton?.text) {
    sectionTitle.value = content.about.topButton.text;
    titleSet = true;
  }
  if (!subtitleSet && content?.promo?.tagLine) {
    sectionSubtitle.value = content.promo.tagLine;
    subtitleSet = true;
  }

  if (!sectionTitle.value) {
    sectionTitle.value = DEFAULT_TITLE;
  }
  if (!sectionSubtitle.value) {
    sectionSubtitle.value = DEFAULT_SUBTITLE;
  }

  activeFilter.value = '*';
}

function setFilter(filter) {
  activeFilter.value = filter;
}

watch(
  () => pageContent.value,
  (content) => {
    applyPortfolio(content || {});
  },
  { immediate: true }
);

watch(
  filteredProjects,
  (nextList) => {
    stageDisplayedProjects(nextList);
  },
  { immediate: true }
);

watch(
  displayedProjects,
  () => {
    nextTick(() => {
      if (!portfolioSection.value) return;
      const targets = portfolioSection.value.querySelectorAll('.js-scroll-fade');
      if (targets.length) {
        registerScrollReveal(targets);
      }
    });
  },
  { immediate: true }
);

function buildProjectRecord(project = {}, index = 0) {
  const tagEntries = parseTagEntries(project?.tags);
  const normalizedTags = tagEntries.map(({ key }) => key);
  const displayTags = tagEntries.map(({ label }) => label).join(', ');
  const baseKey =
    project.id ||
    project.key ||
    project.slug ||
    project.img ||
    (project.title ? project.title.replace(/\s+/g, '-').toLowerCase() : `project-${index}`);
  return {
    ...project,
    key: baseKey,
    tagEntries,
    normalizedTags,
    displayTags,
  };
}

function stageDisplayedProjects(nextList = []) {
  pendingProjects.value = nextList;
  const nextKeySet = new Set(nextList.map((project) => project.key));
  const keepers = displayedProjects.value.filter((project) => nextKeySet.has(project.key));
  const nextLeaving = displayedProjects.value.length - keepers.length;
  leavingCount.value = nextLeaving;
  if (nextLeaving > 0) {
    displayedProjects.value = keepers;
    return;
  }
  displayedProjects.value = nextList;
  pendingProjects.value = null;
}

function handleAfterLeave() {
  if (leavingCount.value <= 0) return;
  leavingCount.value -= 1;
  if (leavingCount.value === 0 && pendingProjects.value) {
    displayedProjects.value = pendingProjects.value;
    pendingProjects.value = null;
  }
}
</script>

<style scoped>
.portfolio-section {
  --section-divider-color: var(--portfolio-divider-color, var(--brand-border-highlight, rgba(79, 108, 240, 0.28)));
  --section-description-color: var(--portfolio-subtitle-color, var(--ui-text-muted, rgba(31, 42, 68, 0.72)));
}

.portfolio-filters {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  list-style: none;
  margin: 0 0 clamp(16px, 4vw, 32px);
  padding: 0;
}

.portfolio-filter {
  padding: 6px 18px;
  border-radius: 999px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  cursor: pointer;
  border: 1px solid var(--portfolio-filter-border, rgba(79, 108, 240, 0.24));
  color: var(--portfolio-filter-color, var(--ui-text-primary, #1f2a44));
  background: var(--portfolio-filter-bg, rgba(79, 108, 240, 0.05));
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.portfolio-filter:hover,
.portfolio-filter:focus-visible {
  color: var(--portfolio-filter-hover-color, var(--brand-accent-electric, #4361dd));
  border-color: var(--portfolio-filter-hover-border, rgba(67, 97, 221, 0.55));
  transform: translateY(-1px);
}
.portfolio-filter:focus-visible {
  outline: 2px solid var(--portfolio-filter-focus-outline, var(--brand-accent-electric, #4361dd));
  outline-offset: 2px;
}

.portfolio-filter--active {
  color: var(--portfolio-filter-active-color, #fff);
  background: var(--portfolio-filter-active-bg, var(--brand-accent-electric, #4f6cf0));
  border-color: transparent;
}
.portfolio-filter--active:hover,
.portfolio-filter--active:focus-visible {
  color: var(--portfolio-filter-active-color, #fff);
  border-color: transparent;
  transform: translateY(-1px);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--portfolio-filter-active-bg, #4f6cf0) 45%, transparent);
}

.portfolio-grid {
  display: flex;
  flex-wrap: wrap;
  gap: clamp(18px, 4vw, 32px);
  justify-content: center;
  width: 100%;
  max-width: min(1120px, 100%);
  margin: 0 auto;
}

.portfolio-grid__item {
  flex: 0 1 320px;
  width: min(320px, 100%);
  display: flex;
}

.portfolio-grid__item .portfolio-card {
  width: 100%;
}

.portfolio-card {
  padding: clamp(10px, 1.8vw, 16px);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  position: relative;
}

.portfolio-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.18);
}

.portfolio-card__link {
  position: absolute;
  inset: 0;
  z-index: 2;
  text-indent: -9999px;
}

.portfolio-card__link:focus-visible {
  outline: 2px solid var(--brand-accent-electric, #4f6cf0);
  outline-offset: 4px;
}

.portfolio-image-frame {
  width: 100%;
  padding: clamp(8px, 2.2vw, 14px);
  border-radius: var(--portfolio-image-radius, 18px);
  background: var(--portfolio-image-bg, rgba(255, 255, 255, 0.08));
  border: 1px solid var(--portfolio-image-border, rgba(255, 255, 255, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
}

.portfolio-image {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
  object-position: center;
  filter: drop-shadow(0 8px 18px rgba(15, 23, 42, 0.18));
}

.portfolio-tag {
  color: var(--portfolio-tag-color, var(--ui-text-muted, rgba(31, 42, 68, 0.72)));
}

.portfolio-title {
  margin: 0;
  color: var(--portfolio-title-color, var(--ui-text-primary, #1f2a44));
}

.portfolio-move {
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.portfolio-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
}

.portfolio-enter-active {
  transition:
    opacity 0.2s ease 0.08s,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1) 0.08s;
}

.portfolio-enter-from,
.portfolio-leave-to {
  opacity: 0;
  transform: translateY(24px) scale(0.96);
}

</style>
