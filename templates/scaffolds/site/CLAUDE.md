# site-__SLUG__

(staging URL TBD)

A site built on the [`@koehler8/cms`](https://github.com/koehler8/cms) framework. **Owner: TBD.** This file is auto-loaded by Claude Code in this directory — read it before making changes.

## Project status

Freshly scaffolded via `npx cms-create-site`. Home page renders the bundled `Header` + `Hero` + `Footer` components with placeholder copy. No theme, extension, or custom components yet — see "Where things go" below for the path each new addition should take.

## Working with the site owner

Assume the owner is not a developer unless you know otherwise. Default behaviors:

- Explain trade-offs in plain language; propose options, don't present decisions.
- Confirm before structural or visual changes that will be hard to reverse.
- Push small, reviewable changes frequently and verify on the live URL.
- Don't over-engineer — most requests can be satisfied by editing `pages/*.json` + bundled CMS components. Reach for a custom Vue component only when the bundled set clearly can't do the job.

## Where things go (the navigation guide)

| Goal | Where |
|---|---|
| Edit page copy / hero text / section content | `site/content/{locale}/pages/{pageId}.json` under `content.{configKey}.*` keys |
| Edit site title, theme key, support email | `site/content/{locale}/site.json` |
| Edit header logo text, nav items, footer flags | `site/content/{locale}/shared.json` |
| Add a translation | Mirror the keys you want to override into `site/content/{otherLocale}/...` (only set the keys that differ — the rest inherit from the base locale) |
| Add an asset (image, icon) | `site/assets/img/...`. Reference it from a component via `resolveAsset('img/foo.png')` or a URL string in content (`"img/foo.png"`) |
| Override the favicon | Drop a real `.ico` at `site/favicon.ico`; the `cms-generate-public-assets` script picks it up |
| Add a one-off Vue component (this site only) | `site/components/Foo.vue`. Auto-globbed by the CMS — reference it as `"Foo"` in any page's `components[]`. Read content via `inject('pageContent')`, use `<style scoped>` with `var(--brand-*)` tokens. |
| Add a component intended to be reused on other sites | The local extension at `extensions/<slug>/`. Add `components/Foo.vue`, register it in `extension.config.json`, and add a dynamic import to `index.js`. Eventually publishable as `@koehler8/cms-ext-<slug>`. |
| Customize colors, typography, surfaces | `themes/<slug>/theme.config.js`. The CMS regenerates `virtual:cms-theme-vars.css` from the manifest on next build; CMS components consume the vars via `var(--brand-*)`. |
| Activate a theme | Set `"theme": "<slug>"` in `site/content/{baseLocale}/site.json`. |
| Add a new page | Create `site/content/{locale}/pages/{pageId}.json` with a `path` and `components[]` array. vite-ssg pre-renders one HTML file per page automatically. |
| Add a new locale | Create `site/content/{locale}/...` mirroring the base locale's structure. Auto-discovered. |
| Add a new theme to the project | `npx cms-create-theme <slug>` (scaffolds `themes/<slug>/`, then follow the printed next-steps). |
| Add a new local extension | `npx cms-create-extension <slug>`. |

If you find yourself writing a component that conceptually belongs in a "regions" or "agents" or "podcasts" sister site, **promote it from `site/components/` into `extensions/<slug>/`** so it can eventually become a published shared package.

## Stack at a glance

- `@koehler8/cms` ^1.0.0-beta.15+ — Vue 3 + vite-ssg framework
- `@koehler8/cms-ext-compliance` — cookie banner / legal pages (registered by default)
- `[site/components/](site/components/)` — auto-globbed Vue files for one-off custom UI specific to this site. **The default home for new components.**
- `[themes/](themes/)`, `[extensions/](extensions/)` — currently empty. Add via the `cms-create-{theme,extension}` CLIs above.

## File layout

```
site/content/{locale}/        per-locale content (auto-discovered)
  site.json                   site title, description, theme key, support email
  shared.json                 cross-page settings — header logo / nav, footer flags
  pages/{pageId}.json         per-page components[] + content.{configKey}.* keys
  pages/home.json             home page (the only page in a freshly scaffolded site)
site/components/              auto-globbed Vue files (the default home for one-off
                              custom UI). Reference by basename in components[].
site/assets/img/              site-specific images / icons
site/style.css                non-critical site overrides (loaded async by the CMS;
                              fine for things that wouldn't cause a visible flash)
site/favicon.ico              optional override; `cms-generate-public-assets`
                              picks it up over the auto-generated letter-favicon
themes/<slug>/                site-local CMS theme — destined to lift into a
                              standalone @koehler8/cms-theme-<slug> repo
extensions/<slug>/            site-local CMS extension — destined to lift into a
                              standalone @koehler8/cms-ext-<slug> repo
```

## Common tasks (quick recipes)

### Edit hero / footer copy
Open `site/content/{baseLocale}/pages/home.json`. Hero text lives under `content.promo.*`; footer text under `content.footer.*` (or whatever configKey the components use). Push and the deploy pipeline picks it up.

### Edit nav links
`site/content/{baseLocale}/shared.json` → `content.header.navItems[N]`. Each entry is `{ text, href, target? }`. Add `"target": "_blank"` for off-site links.

### Add a custom component
1. Create `site/components/Foo.vue`.
2. `inject('pageContent')` for content; `<style scoped>` with `var(--brand-*)` tokens.
3. Reference as `"Foo"` in any page's `components[]`.

### Add a new page
1. Create `site/content/{baseLocale}/pages/{pageId}.json` with a `path` (e.g. `/about`) and `components[]`.
2. Add a `navItems` entry pointing at the new path in `shared.json` if it should be in the nav.
3. Push — vite-ssg generates `dist/{path}/index.html` automatically.

### Change colors / typography
Edit `themes/<slug>/theme.config.js`. The CMS regenerates `virtual:cms-theme-vars.css` from the manifest on next build; CMS components and your custom components consume the vars via `var(--brand-*)`, so the change cascades.

## Lockfile and npm version — read before bumping any dep

This project pins **Node 20.19 / npm 10.8** to match AWS Amplify exactly. Local installs with a different npm version produce subtly different lockfiles that look fine locally but break CI.

Two failure modes seen on sister sites:
1. `Cannot find module '@rolldown/binding-linux-x64-gnu'` — npm 11 regen stripped optional-dep entries Amplify needs.
2. `npm ci ... Missing: @types/react@..., @noble/hashes@... from lock file` — npm 11 omitted entries npm 10 expects.

Rules:
- **Always run `nvm use` before `npm install`**. `.nvmrc` pins 20.19.0 (which ships npm 10.8.x).
- **Prefer targeted bumps**: `npm install <pkg>@<ver> --no-audit --no-fund`. **Never** `rm package-lock.json && npm install` unless you're on the pinned npm version.
- **The build uses `npm install`**, not `npm ci` (see `amplify.yml`) for drift tolerance.

## Local dev

```bash
nvm use
cp .env.example .env       # placeholder values; not used by default
npm install
npm run dev                # Vite dev server on http://localhost:5173
```

Build:

```bash
npm run generate:public-assets   # generates favicon/og-image from site.json
npm run build:ssg                # pre-renders dist/{locale}/{page}/index.html
```

## Deploy

Pushes to `main` trigger an automatic AWS Amplify build per `amplify.yml`. Set up the Amplify app + custom domain via the AWS console (or `aws amplify create-app` + `create-domain-association`) — see the existing sister sites' setup notes if available, or the koehler8 site repos as reference.
