# Browser checks for a fleet pass

`bump-site.sh` proves the **built HTML** is unchanged. It cannot see runtime behaviour — hydration, in-SPA
navigation, what a framework fix does after mount. These are the in-browser checks that closed that gap during the
2026-09-19 dependency fan-out and the cms 1.3.1 pass. They run against the **built** output (`vite preview`), never the
dev server, and use **live production as the control**: until you push, production *is* the previous build.

## Setup

- Workspace-root `.claude/launch.json` has one reusable entry, **`fleet-preview`** (port 5227). It serves whichever site
  name is written in `.claude/fleet-preview-site`. The name is read at server start, so: write the file →
  `preview_start fleet-preview` → check → `preview_stop` → next site.
- Build first (`bump-site.sh` leaves the post-bump `dist/` in place).
- The browser pane has a tab cap (~9). Close tabs as you go, or `preview_start` reports "Tab cap reached".

## 1. Identity check against live production (any site)

Run the same measurement on the local build and on the live site, and compare. Identical output = no visitor-visible
difference in structure or text on those routes.

```js
const app = document.querySelector('#app').__vue_app__;
const r = app.config.globalProperties.$router;
try { localStorage.removeItem('cms_locale'); } catch (e) {}
const root = () => document.querySelector('#app');
const out = {};
for (const p of ['/', '/privacy', '/terms']) {            // the site's real routes; 4-5 per call
  await r.push(p);
  await new Promise((x) => setTimeout(x, 3500));           // 5000 on multi-locale sites
  out[p] = [
    document.documentElement.lang,
    root().querySelectorAll('section').length,
    root().querySelectorAll('h1,h2,h3,h4').length,
    root().querySelectorAll('a').length,
    document.images.length,
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,   // broken images
    root().innerText.replace(/\s+/g, ' ').length,
    document.title.slice(0, 34),
    document.querySelector('link[rel=canonical]')?.href,
  ].join(' | ');
}
const s = JSON.stringify(out); let h = 0;
for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
({ vue: app.version, hash: h, out });
```

Traps, each of which produced a false alarm:

- **Wait ~5 s per route on multi-locale sites.** Live loads locale chunks over the network; a 2.6 s settle gave a false
  hash mismatch on numu.se. Keep a call under ~45 s (the JS tool times out): 4–5 routes per call, split the rest.
- **Clear `cms_locale` and RELOAD before measuring.** Removing the key after the app has booted is too late — the saved
  locale was read at load, and the chrome (nav/footer labels) renders localized. Symptom: a *constant* character offset
  on every English page (+34 on getpeepoo.com). `localStorage.clear()` → navigate → measure.
- **The console buffer survives navigation within a tab.** Errors from the previous site (e.g. Reown 403s) show up under
  the next one. Confirm with `performance.getEntriesByType('resource')` for the current page before believing them.
- **Sites that register `cms-ext-crypto`** (vor, tkrpkr, moodz) log 403s from `api.web3modal.org` on localhost — Reown
  rejects the origin. Environmental, identical before and after.
- A site that fetches content at build time (`site-resom`: YouTube feed → `home.json`) legitimately differs from live in
  text length on that page only; structure must still match.
- Asset hashes never match between a Mac build and Amplify's Linux build of the same commit. Don't compare them.

## 2. Saved-locale flow (multi-locale sites) — what cms 1.3.1 fixed

```
localStorage.clear()  → load /      expect lang=en, og:locale=en, canonical=<site>/
load /de  (stores cms_locale=de)    expect lang=de
load /                              content is German. 1.3.0: lang=en, og:locale=en, canonical=<site>/   (the bug)
                                                      1.3.1: lang=de, og:locale=de, canonical=<site>/de
localStorage.cms_locale='xx' → /    falls back to the base locale cleanly
```

Read with:

```js
({ lang: document.documentElement.lang,
   ogLocale: document.querySelector('meta[property="og:locale"]')?.content,
   canonical: document.querySelector('link[rel=canonical]')?.href,
   h1: document.querySelector('h1')?.innerText, saved: localStorage.getItem('cms_locale') })
```

Also require **zero console output** on `/` with a saved locale: the fix must act after mount, not cause a hydration
mismatch. Clean up after a live check: `localStorage.removeItem('cms_locale')`.

## 3. Analytics spy — observe engagement events without sending any

```js
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);   // see note
window.__ev = [];
window.gtag = function () { window.__ev.push([...arguments]); };                      // non-forwarding
for (const y of [0.3, 0.6, 1]) {
  window.scrollTo(0, document.documentElement.scrollHeight * y);
  window.dispatchEvent(new Event('scroll'));
  await new Promise((r) => setTimeout(r, 400));
}
window.__ev.filter((a) => a[0] === 'event').map((a) => ({ name: a[1], locale: a[2]?.locale, depth: a[2]?.depth_percent }));
```

- Replacing `gtag` with a spy that does **not** forward keeps test scrolling out of the real GA property.
- The scroll handler runs inside `requestAnimationFrame`, and **a hidden browser pane composites no frames** — without
  the first line no event ever fires and it looks like tracking is broken.
- Expected: `engagement_scroll_depth` at 25/50/75/90/100. `locale` is `""` on cms ≤ 1.3.0 for base-locale pages, the real
  code (`"en"`, `"de"` in the restored state) from 1.3.1.
- Events only fire when `shouldEnableAnalytics()` is true (consent accepted, or the site runs opt-out mode).

## 4. Owner-operated and accessibility-sensitive sites

For Jamie Austin's sites (coastalcollective, cityofangels, ocandme, jamieaustin, resom) also check, against live:
keyboard `Tab` reaches the header controls with a visible `:focus-visible` ring (same computed `outline` / `box-shadow`
on both), a skip link is first, exactly one `<main>` and one `<h1>`, 404 is `noindex`, and 375 px has no element past
the right edge. Known pre-existing nit, identical on live: coastalcollective's header dropdowns open via
`:focus-within` while `aria-expanded` stays `false`.
