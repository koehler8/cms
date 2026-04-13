# Contributing to @koehler8/cms

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+

### Setup

```bash
git clone https://github.com/koehler8/cms.git
cd cms
npm install
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Project Structure

This is a **library** — there is no dev server. To test changes, link the package into a consuming site repo.

```
vite-plugin.js        Vite plugin (entry point for consuming sites)
src/
  components/         Built-in Vue components
  composables/        Vue 3 composition API hooks
  utils/              Core utilities
  themes/             Theme loader, manager, validator
  extensions/         Extension loader
  router/             Vue Router configuration
themes/base/          Default theme manifest
extensions/           Extension manifest JSON schema
tests/                Vitest test suite
scripts/              Build-time scripts (asset generation, validation)
bin/                  CLI entry points
```

## Making Changes

1. **Create a branch** from `main`
2. **Make your changes** — follow the existing code style (ESM, Vue 3 composition API)
3. **Add or update tests** for any new or changed functionality
4. **Run `npm test`** to verify all tests pass
5. **Submit a pull request** with a clear description of the change

## Code Style

- ES modules (`import`/`export`) throughout
- Vue 3 Composition API for components and composables
- No TypeScript (plain JS with JSDoc where helpful)
- Prefer simple, direct code over abstractions

## What to Contribute

- Bug fixes with a test case
- Documentation improvements
- New built-in components (discuss in an issue first)
- Theme or extension system enhancements (discuss in an issue first)
- Performance improvements

## What to Discuss First

Please open an issue before working on:

- New features or components
- Architectural changes
- Breaking changes to the plugin API or config format
- Changes to the theme token structure

## Reporting Bugs

Use the [bug report template](https://github.com/koehler8/cms/issues/new?template=bug_report.md) and include:

- Steps to reproduce
- Expected vs actual behavior
- Framework version (`package.json` version)
- Node.js version

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
