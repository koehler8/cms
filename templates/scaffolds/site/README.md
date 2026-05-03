# site-__SLUG__

A site built on [`@koehler8/cms`](https://github.com/koehler8/cms).

For architecture, conventions, and a navigation guide for "where things go" (content, components, themes, extensions), read **[CLAUDE.md](CLAUDE.md)**.

## Local development

```bash
nvm use                    # Node 20.19.0 per .nvmrc
cp .env.example .env
npm install
npm run dev
```

## Build

```bash
npm run generate:public-assets
npm run build:ssg
```

## Deployment

Pushes to `main` trigger an automatic AWS Amplify build (see [amplify.yml](amplify.yml)).
