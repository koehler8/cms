# SSG build out-of-memory — durable framework fix (design doc)

**Status:** Proposal / design only. No framework code, deps, or site config changed by this document.
**Scope:** `@koehler8/cms` (currently `1.0.0-beta.34`) SSG pre-render (`vite-ssg build`).
**Author trigger:** `site-peepoo` (662 routes) and `site-poopee` (~377 routes) began failing the AWS Amplify build with `FATAL ERROR: … JavaScript heap out of memory` (exit 134) on 2026-07-03, two days after both were green.
**Author:** Claude (investigation session 2026-07-03), grounded in reproduction + heap profiling on `site-peepoo`.

---

## 0. TL;DR

- **Reproduced deterministically** and profiled on `site-peepoo`. The OOM is a **true retention leak**, not a transient concurrency spike: at **concurrency = 1 with a forced `global.gc()` after every route**, post-GC live heap still climbs **ruler-straight at 6.05 MB per rendered route** (84 MB → 3177 MB over 512 routes). This exactly reproduces the field numbers (completes at `--max-old-space-size=8192`, peak RSS ~4.9 GB; fails at 4096).
- **What is retained:** heap snapshot shows **exactly one jsdom `Document` (`DocumentImpl`) retained per rendered route** (101 documents at route 100), plus its transitive DOM + strings. String data dominates (≈440 MB of 687 MB at route 100). The leak is **JS-heap** (native/`external` memory stays flat at ~6 MB).
- **Where it lives:** the retained documents come from **`new JSDOM(renderedHTML)` inside vite-ssg's own render loop** (`vite-ssg@28.3.0`), which renders every route in one process and never releases the per-route DOM. **It is in the dependency, not in `@koehler8/cms`'s own modules.**
- **Not fixable by the cheap knobs.** Empirically: lowering `concurrency` doesn't bound it (accumulation is per-route, not per-batch); disabling `beasties` critical-CSS changes it **0%**; `jsdom.window.close()` removes only **~17%**. Raising the heap / instance size (the current stopgap) only moves the cliff — cost scales linearly with content.
- **A large, self-inflicted multiplier:** every page embeds `window.__INITIAL_STATE__` = the **entire site config for all pages** — measured at **218 KB, 81 % of each 270 KB page, byte-identical across pages**. That inflates both the on-disk payload (an SEO problem) and the per-route jsdom retention.
- **Recommendation — two tracks.**
  - **Track 1 (days, low-risk, also fixes the SEO payload):** trim `__INITIAL_STATE__` to the current page; set a conservative `ssgOptions.concurrency` default; ship a documented heap default as a *temporary bridge* for unmitigated sites. This ~3× the runway but does **not** bound memory.
  - **Track 2 (the durable bound):** a framework-owned **build-once + sharded render across recycled child processes** (`cms-ssg-build`). Peak memory becomes `O(shard size)`, **independent of total route count** — the only option that truly bounds. Roll out behind a flag, verify byte-identical output, then retire the `LARGE_16GB` + `NODE_OPTIONS` stopgaps.
- **Urgent fleet finding — ✅ resolved 2026-07-03:** `site-bang` (~360 routes, beta.34, generates extra pages at build) sat at the same cliff `site-poopee` hit and was unmitigated. Now bridged: Amplify app bumped to `LARGE_16GB`, then `--max-old-space-size=8192` pinned on its `vite-ssg build` step (`8f63144`). `site-poopee` was found already bridged (`6d8bf39`). **Phase 0 (§4.1) is complete** — all three heavy sites now run `LARGE_16GB` + explicit `8192`.

---

## 1. Root cause (grounded in profiling)

### 1.1 What I verified vs. the triage brief (things had drifted)

| Claim (triage) | Verified? | Actual |
|---|---|---|
| Framework ~beta.32 | ⚠️ drifted | `package.json` is **beta.34**; `site-peepoo` has **beta.31** installed while declaring `^1.0.0-beta.32` (lockfile drift — the deployed sites may be a version behind the range). |
| vite-ssg pre-renders every route in one process; peak scales with routes and accumulates | ✅ | `vite-ssg@28.3.0`. Confirmed by profiling (below). |
| Exit 134 = V8 heap cap, not kernel OOM-killer (137) | ✅ | Reproduced: V8 `FATAL ERROR … heap out of memory`. |
| Concurrency 20→6 didn't fix it | ✅ (and stronger) | Accumulation is **per-route and survives forced GC at concurrency 1** — concurrency tuning cannot bound it. |
| ~7 MB per route; completes at 8192, fails at 4096 | ✅ | Measured **6.05 MB/route** retained; extrapolates to ~4.1 GB heap / ~4.9 GB RSS at 662 routes. |
| Root cause of accumulation "not determined" | ✅ now determined | **One retained jsdom `Document` per route** created inside vite-ssg's render loop. See §1.3–1.5. |
| `ssgOptions` has `dirStyle:'nested'`, `onFinished` 404 copy, locale-expanding `includedRoutes`, no `concurrency` | ✅ | Confirmed verbatim in [vite-plugin.js](vite-plugin.js) (`config()` return, `ssgOptions` block). |

Environment for all measurements: Node **20.19.0** / npm **10.8.3** (matches the Amplify pin), macOS, `site-peepoo` = 44 pages × 15 locales + `/admin` + `/404` = **662 routes**. Peer stack: `vite@8`, `vue@3.5`, `vue-router@5`, `@unhead/vue@2.1.15`.

### 1.2 How vite-ssg renders (read from `vite-ssg@28.3.0/dist`)

`build()` (in `dist/shared/vite-ssg.*.mjs`) does, in one Node process:

1. `vite build` for the **client** bundle, then again for the **SSR** bundle (two full bundle passes).
2. `import()` the SSR bundle → `createApp` (this is the framework's `createCmsApp()` from the generated `.cms-entry.js`).
3. Expand routes via the framework's `ssgOptions.includedRoutes` → 662 paths.
4. `const queue = new PQueue({ concurrency })` — **`concurrency` defaults to `20`** (the framework sets none). Then **for each route**, inside a queued task:
   - `createApp(route)` → a fresh Vue app + router + Pinia + unhead `initialState`.
   - `renderToString(app)` → app HTML.
   - `renderHTML(...)` → splices app HTML + `window.__INITIAL_STATE__ = <serialized initialState>` into the index template.
   - **`const jsdom = new JSDOM(renderedHTML)`** → parses the whole page into a jsdom DOM. Used to inject preload links (`renderPreloadLinks`) and render `<head>` (`@unhead/dom` `renderDOMHead`). **`jsdom.window.close()` is never called.**
   - `beasties.process(html)` — **critical-CSS inlining is ON by default** (a single reused `beasties` instance).
   - `formatHtml`, then **`fs.writeFile(...)`** — output is **streamed to disk per route**.
5. `await queue.start().onIdle()`, then `onFinished()` (the framework's 404.html copy).

**Two structural facts that rule out easy hypotheses:**
- **Output is not accumulated.** Each task writes its file and returns nothing; there is no results array. So peak memory = *concurrent working set + any leak*, **not** "all rendered HTML held to the end."
- **The heavy per-route work is a fresh Vue render + a full jsdom parse + beasties**, all under `concurrency = 20`.

The framework's control surface is total: `mergedOptions = Object.assign({}, config.ssgOptions, cliOptions)`, and the CLI accepts no `--concurrency`. So the framework owns `concurrency`, `beastiesOptions`, `formatting`, `dirStyle`, `includedRoutes`, `onFinished` — but **not** the `new JSDOM` line itself.

### 1.3 Reproduction: leak vs. transient (the decisive experiment)

I instrumented the installed `vite-ssg` copy in `site-peepoo/node_modules` (ephemeral, gitignored, reverted afterward) to (a) override `concurrency`, (b) optionally force `global.gc()` after each route, and (c) log `process.memoryUsage()` per route. Then rendered at **concurrency = 1 with `--expose-gc` and a forced GC after every route** — so only one route is ever in flight and everything collectable is collected each step.

Post-GC live heap (`heapUsed`), concurrency = 1, forced GC:

```
route     rss   heapUsed   ext   (MB)
    1     607        84      13
   85    1109       593       6
  169    1631      1102       6
  253    2153      1610       7
  337    2675      2118       7
  421    3197      2626       8
  505    3717      3134       8
  512    3761      3177       8
---
heapUsed slope (back half): 6.051 MB/route
rss      slope (back half): 6.208 MB/route
```

**Interpretation:** with a single route in flight and GC forced every step, live heap **still grows monotonically and linearly at 6.05 MB/route**. That is the signature of a **retention leak** (reachable objects that survive GC), not a transient working set. `external`/`arrayBuffers` stay flat at ~6–8 MB, so the leaked bytes are **on the V8 JS heap**, not jsdom's native allocations. Extrapolating to 662 routes: ≈ 84 + 661×6.05 ≈ **4.1 GB heap** — consistent with "fails at 4096, needs 8192, peak RSS 4.96 GB."

This also explains the field observation that dropping `concurrency` 20→6 didn't help: concurrency bounds the *batch*, but the leak accrues *per route regardless of batch*.

### 1.4 What is retained (heap snapshot at route 100, post-GC)

I dumped a `v8.writeHeapSnapshot()` at route 100 (concurrency = 1, after a double GC) and aggregated it (custom buffer parser — the 1.2 GB snapshot exceeds Node's max string length). Retained self-size by type:

```
   339 MB  concatenated string   (11.1M of them)
    98 MB  string
    95 MB  array
    86 MB  object            ← incl. jsdom AttrImpl, CSSStyleDeclaration, Attr…
    23 MB  closure
   ...
total ≈ 687 MB across 17.3M nodes
```

Object instances by constructor include unmistakable **jsdom** classes: `AttrImpl`, `SymbolTreeNode` (jsdom's symbol-tree), `CSSStyleDeclaration`, `TextImpl`, `HTMLSpanElementImpl`, `Node`, `Position`, `Attr`, `DocumentImpl`.

**Instance counts nail it:**
- **`DocumentImpl` = 101** at route 100 → **≈ 1 retained jsdom document per rendered route.**
- `Window` = 200 → ≈ 2 window objects per route (jsdom's window + its proxy).

So each rendered route leaves **one fully-parsed jsdom document** alive. Its self-size (node objects) is only ~a few hundred KB, but its **retained** size — all the text/attribute/class **strings** and DOM nodes it holds — is ≈ **6 MB**, which is the per-route slope. Strings dominate because jsdom stores every attribute value and text node as a distinct JS string, and the page is string-heavy (see §1.6).

Retaining-path tracing (forward BFS from GC roots, weak edges excluded) puts the leaked documents under the `JSDOM` / `Window` objects created in vite-ssg's loop. The 100 documents are **not** collected into a single shared container (no array/Map with ~100 document edges) — each is retained by its own chain rooted in the vite-ssg render pipeline. Closing that reference is not something the framework can do from its own source; the `new JSDOM` and the missing teardown are inside vite-ssg.

### 1.5 Falsification tests (why the cheap fixes don't work)

Same rig (concurrency = 1 + forced GC), one variable changed at a time:

| Variant | Slope | Verdict |
|---|---|---|
| Baseline | **6.05 MB/route** | reference |
| `jsdom.window.close()` after serialize | **5.02 MB/route** (−17 %) | Closing the window frees its event-loop/resources but **not** the retained document graph. Insufficient. |
| `beasties` (critical CSS) disabled | **6.06 MB/route** (0 %) | The reused beasties instance is **not** the accumulator. |

Neither knob bounds the leak. This is the empirical backbone of the recommendation: **you cannot fix this with `ssgOptions` alone; you must stop rendering an unbounded number of routes in one process** (or eliminate the jsdom step in vite-ssg, which requires patching/forking the dependency).

### 1.6 The `__INITIAL_STATE__` multiplier (framework-owned, independently a bug)

Measured on the rendered output:

```
dist/index.html      total 270,558 B   __INITIAL_STATE__ 218,188 B  (81% of page)
dist/es/index.html   total 272,055 B   __INITIAL_STATE__ 218,188 B  (81%, byte-identical blob)
```

`main.js`'s SSG setup calls `loadConfigData({locale})`, which returns the **entire inflated site config for every page**, and stores it in `initialState.siteConfig`; vite-ssg serializes that into `window.__INITIAL_STATE__` on **every** page. So all 662 pages ship the same ~213 KB all-pages config. (The framework already half-acknowledges this — CHANGELOG for the hydration work notes "Pinia + ViteSSG serialize the full inflated … via `__INITIAL_STATE__`.")

Consequences:
- **Per-route retention multiplier:** each retained jsdom document holds a parsed copy of this 213 KB blob plus its DOM — a large part of the 6 MB/route.
- **SEO / payload:** every crawled page carries ~213 KB of duplicate JSON (a real transfer/soft-quality cost, independent of the build).

Trimming `initialState` to the *current* page's config is a framework-owned change that shrinks both. It does not *bound* memory (jsdom still retains the rendered body per route), but it materially lowers the slope and is a genuine SEO win.

---

## 2. Options (with trade-offs)

Assessment axes: **Bounds peak?** (does peak memory stop scaling with total routes) · **Build-time cost** · **Fleet rollout risk** · **Backward-compat / output fidelity** · **Effort**.

### Option A — Raise the ceiling (the current stopgap)
`buildComputeType=LARGE_16GB` + `NODE_OPTIONS=--max-old-space-size=8192` in `build:ssg`.
- Bounds peak? **No** — linear in routes; buys ~1 month per the field note.
- Build cost: none. Risk: low. Fidelity: identical. Effort: none (already applied to some sites).
- **Verdict:** bridge only. Explicitly to be **retired** by the durable fix. Two placement caveats, both confirmed in Phase 0: **(1)** an 8 GB heap on an 8 GB `STANDARD_8GB` container gets OS-OOM-killed — **the instance bump must land before the heap flag**; **(2)** when `build:ssg` is a `&&` chain with `vite-ssg build` **not first** (e.g. `site-bang`'s `generate:piece-pages && generate:feed && vite-ssg build && …`), the flag must sit **directly on `vite-ssg build`** — a leading whole-string `NODE_OPTIONS=` assignment scopes to only the first command in the chain and silently leaves the render pass unmitigated.

### Option B — Reduce per-route cost (trim `__INITIAL_STATE__`; optionally tune concurrency)
Trim `initialState.siteConfig` to the current page (+ shared/site globals); the client already lazy-loads other pages' config via the config-loader glob for in-SPA navigation. Optionally set a conservative `ssgOptions.concurrency`.
- Bounds peak? **No** — still linear, but the slope drops materially (smaller pages ⇒ smaller retained jsdom docs), and it removes the 81 %-of-page SEO bloat.
- Build cost: neutral/slightly better. Risk: **medium** — changes hydration/first-nav semantics; must verify SSR/CSR parity and that in-SPA navigation still resolves other pages. Fidelity: page *content* identical; the embedded state blob shrinks (intended).
- Effort: moderate. **Verdict:** high-value complement; ship early. Not sufficient alone.

### Option C — Split the render per locale via repeated `vite-ssg build`
Invoke `vite-ssg build` once per locale (or route-group), each with a narrowed `includedRoutes`, merging `dist/`.
- Bounds peak? **Yes** (per-invocation route count is bounded).
- Build cost: **bad** — vite-ssg rebuilds *both* bundles on every invocation; ×15 locales ≈ 15× the (already double) bundle build. Fidelity: good if merge is careful. Risk: medium (merge correctness, `onFinished`/404 once).
- **Verdict:** bounds memory but the build-time blow-up makes it a poor durable choice. Rejected in favor of D.

### Option D — Build once, render route-shards in recycled child processes (**the durable bound**)
A framework-owned build command (`cms-ssg-build`, or an opt-in path): run the client + SSR bundle build **once**, then render the route list in **shards of ≤ K routes**, each in a **fresh Node child process** that imports the pre-built SSR bundle + `ssr-manifest` + `index.html`, renders its slice (reusing vite-ssg's render loop), writes to the shared `dist/`, and **exits** (OS reclaims everything). A small pool renders shards in parallel; a final pass runs `onFinished` (404 copy) once.
- Bounds peak? **Yes, truly** — peak = `K × per-route cost + base`, **constant in total routes**. Choosing `K` (e.g. 100) and heap (e.g. 2 GB/worker) makes peak deterministic for any site size.
- Build cost: one bundle build + parallel render — can be **faster** than today (multi-process render) or neutral.
- Risk: **medium-high** — must reproduce vite-ssg's output byte-for-byte (preload injection, `@unhead/dom` head, beasties, `formatting`, `dirStyle`, 404). Fidelity is the gating concern; mitigate by reusing vite-ssg's own `build()` for the bundle phase and only owning the render **dispatch**, plus a byte-diff gate (see §5).
- Effort: **medium** (the render loop is ~60 lines already read; the new work is the shard driver, child entry, and dist merge). **Verdict:** the recommended durable fix.

### Option E — Patch/upstream vite-ssg (remove or bound the jsdom step)
The framework **already** patches jsdom-via-vite-ssg on postinstall ([scripts/patch-lru-cache-tla.js](scripts/patch-lru-cache-tla.js), INIT_CWD-aware, idempotent) — precedent exists. Two flavors:
- **E1 — postinstall micro-patch** to `jsdom.window.close()` **and null the DOM ref** after serialize. Empirically `close()` alone is only −17 %, so this is **not** a bound; deprioritize.
- **E2 — upstream PR to vite-ssg**: replace the per-route `new JSDOM` with lighter string/`html5parser`-based preload+head injection (vite-ssg already imports `html5parser`), or add a memory-bounded/render-slice mode. This is the clean long-term fix but **depends on an external maintainer**; pair with D as interim.
- Bounds peak? E1 no; E2 yes (if it removes the retained DOM). Risk: patching a minified dist is brittle across versions. **Verdict:** file E2 upstream regardless; do **not** rely on it to land in time.

### Option F — Promote the heap flag to a documented framework default
Ship `NODE_OPTIONS=--max-old-space-size=<N>` as the template default and document it.
- Bounds peak? **No.** But it prevents the *silent* 2 GB cliff for unmitigated sites (e.g. `site-bang`) as a stop-loss while D is built.
- **Verdict:** include only as the Track-1 **bridge**, with an explicit retirement step once D lands.

---

## 3. Recommended approach

**Two tracks in parallel.** Track 1 de-risks the fleet in days and is independently worth doing; Track 2 is the true bound the brief asks for ("bounds peak memory, not just raises the ceiling").

### Track 1 — Immediate mitigations (days; low risk; also fixes SEO)
1. **Trim `__INITIAL_STATE__` to the current page** (Option B). Biggest framework-owned lever on the slope, and it removes ~213 KB of duplicate JSON from every page. Guard with SSR/CSR hydration-parity tests and an in-SPA cross-page navigation test.
2. **Set `ssgOptions.concurrency` to a conservative default** (e.g. 8–12) in [vite-plugin.js](vite-plugin.js). Doesn't bound the leak, but caps the *concurrent* working set so peak is predictable and lower on the heaviest sites. Cheap, output-neutral.
3. **Bridge only:** ship a documented heap default (Option F) so unmitigated sites (`site-bang`) don't hit a silent cliff before Track 2. Marked for retirement.

### Track 2 — The durable bound: `cms-ssg-build` sharded/recycled render (Option D)
- New framework build entry that builds bundles once and renders route-shards in recycled child processes, merging `dist/`. Peak memory `O(K)`, independent of route count.
- Ship **behind an opt-in** (`ssgOptions.shardedRender` / a distinct `build:ssg` command) first. Prove **byte-identical `dist/`** vs. today on a heavy multi-locale site (§5), then flip the template default and retire Track-1 bridge + Option-A stopgaps.
- **File the upstream vite-ssg issue/PR (E2)** in parallel; if it lands and bounds memory, `cms-ssg-build` can become a thin shim or be dropped.

**Why D over "just trim + bigger heap":** trim lowers the slope but memory still grows linearly; a fleet that keeps adding pages/locales (and `site-bang` *generates* pages) will re-hit the cliff. Only shard-and-recycle makes peak memory a function of shard size, not content size — which is the definition of durable here.

---

## 4. Phased fleet rollout

A framework change reaches sites only on their **own** dependency bump + redeploy (each site pins `^1.0.0-beta.N`). Plan accordingly.

### 4.0 Fleet risk map (measured: pages × locales)

| Site | Pages | Locales | ~Routes | Heap flag today | Status |
|---|---|---|---|---|---|
| `site-peepoo` | 44 | 15 | **~662** | ✅ `8192` | OOM'd; mitigated via flag + `LARGE_16GB` |
| `site-poopee` | 25 | 15 | **~377** | ✅ `8192` | OOM'd 2026-07-03; **mitigated same day** — `8192` flag (`6d8bf39`, concurrent session) on existing `LARGE_16GB`. Verified on `main`. |
| `site-bang` | 24 | 15 | **~360**+ | ✅ `8192` | Was unmitigated at the cliff; **mitigated 2026-07-03** — Amplify app `d2pmzw52xhoi1f` bumped to `LARGE_16GB`, then `8192` flag pinned on `vite-ssg build` mid-chain (`8f63144`). |
| `site-erea`, `site-trifi`, `site-muse`, `site-disrupt` | 4 | 15 | ~60 | ❌ none | Comfortable now (~0.4 GB); grows ×15 per page/locale added |
| all others | ~4 | 1–2 | ≤ 8 | ❌ none | Negligible; get the fix for free on next bump |

**Reconciled 2026-07-03 — Phase 0 complete (see §4.1).** Both gaps are now closed: `site-poopee` received the `8192` flag (`6d8bf39`, applied by a concurrent session) atop its existing `LARGE_16GB`, and `site-bang` was bumped to `LARGE_16GB` then given the flag (`8f63144`). All three heavy sites (`site-peepoo`, `site-poopee`, `site-bang`) now run `LARGE_16GB` + an explicit `8192` heap. Chained-build caveat surfaced during the fix: `site-bang`'s `build:ssg` is a `&&` chain with `vite-ssg build` **not first**, so the flag had to be placed directly on `vite-ssg build` — a whole-string `NODE_OPTIONS=` prefix would have scoped to only the first command and silently left the render pass unmitigated (see §2 Option A).

### 4.1 Phases

**Phase 0 — Stop-loss ✅ COMPLETE (2026-07-03; before any framework change).** Applied the Track-1 bridge to **`site-bang`**: bumped Amplify app `d2pmzw52xhoi1f` to `LARGE_16GB`, *then* pinned `--max-old-space-size=8192` on its `vite-ssg build` step (`8f63144`) — instance led the flag per the §2 Option A caveat. **`site-poopee`** was found **already** bridged by a concurrent session (`6d8bf39`: `8192` flag) on top of its existing `LARGE_16GB`; verified on `main`, not duplicated. `site-peepoo` was already mitigated. All three heavy sites now carry `LARGE_16GB` + explicit `8192`.

**Phase 1 — Track 1 lands in the framework (beta.N+1).** Trim `__INITIAL_STATE__` + concurrency default + documented heap bridge. Bump the two heavy multi-locale, already-mitigated sites first (`site-peepoo`, `site-poopee`), then `site-bang`, verify green, then let the long tail pick it up naturally. **Preventive template default:** add the heap-flag bridge to the **`site-erea` template `build:ssg`** now so *new* multi-locale sites don't silently inherit the 2 GB cliff (cheap insurance until Track 2).

**Phase 2 — Track 2 opt-in (beta.N+2).** `cms-ssg-build` behind a flag. Dogfood on `site-peepoo` (heaviest). Gate on the byte-diff proof (§5). Measure peak memory flat across shard counts.

**Phase 3 — Track 2 default + retire stopgaps (beta.N+3).** Flip the template + heavy sites to sharded render. Then, per site, in this order: (1) confirm sharded build is green, (2) **remove `NODE_OPTIONS` from `build:ssg`**, (3) **revert Amplify `buildComputeType` to `STANDARD_8GB`** (`aws amplify update-app --app-id <id> --job-config buildComputeType=STANDARD_8GB`), (4) redeploy and confirm. Remove the Track-1 heap bridge from the template. Update the vault gotcha + workspace `CLAUDE.md`.

**Lockfile discipline throughout:** `nvm use` (20.19.0 / npm 10.8) before any install; targeted `npm install @koehler8/cms@<ver>` per site — never `rm package-lock.json`. (Per `cms/CLAUDE.md`, this is the #1 source of consumer deploy failures.)

---

## 5. Verification strategy — prove it *bounds* memory as routes grow

The claim to prove is **"peak memory is a function of shard size, not total route count."** Evidence, not vibes:

1. **Synthetic scaling harness (deterministic OOM + curve).** Generate a synthetic site with N pages × L locales (drive N ∈ {100, 300, 600, 1200, 2400}). For each, run the build capped at a fixed heap (e.g. `--max-old-space-size=2048`) and record peak RSS/heap.
   - *Today:* peak rises linearly; OOM crosses ~330 routes at 2 GB. (Reproduced.)
   - *Track 2 target:* peak **flat** across all N at the same cap; no OOM at 2400 routes. **This is the pass/fail bound test.**
2. **Per-route memory curve (leak regression guard).** Reuse the instrumentation from this investigation (per-route `process.memoryUsage`, `--expose-gc`, forced GC): post-GC `heapUsed` **slope must be ≈ 0** within a shard and reset to baseline at each recycle. Keep the harness in `scripts/` (or `tests/`) so regressions are catchable. Fold into CI as a smoke build of a medium synthetic site under a **tight heap cap that today's code fails** — so a regression re-fails.
3. **Output fidelity (the gating check for Option D).** `diff -r` today's `dist/` vs. sharded `dist/` on `site-peepoo` and one single-locale site; require **byte-identical** per-route HTML, `404.html`, `sitemap.xml`, `robots.txt`, canonical/hreflang/OG/JSON-LD, and `dirStyle: nested` layout. Any diff blocks the flip.
4. **Real-site build matrix.** Green Amplify builds on `site-peepoo` (heaviest), `site-bang` (dynamic pages), one 60-route multi-locale (`site-erea`), and one trivial site — under **`STANDARD_8GB` with no heap flag** (i.e., prove the stopgaps are unnecessary post-fix).
5. **Track-1 sub-checks.** After trimming `__INITIAL_STATE__`: assert the per-page blob no longer contains other pages' content; hydration parity (no console warnings, `#app` unchanged post-hydrate); in-SPA navigation to a *different* page still resolves its config (lazy path). Confirm the ~213 KB/page payload drop.

---

## 6. Risks and open questions

**Risks**
- **Output fidelity under sharding (highest).** Re-driving vite-ssg's render outside its own `build()` risks subtle drift (preload links, `@unhead/dom` head, beasties, whitespace/formatting, 404 copy). *Mitigation:* reuse vite-ssg's `build()` for the bundle phase; own only the render dispatch; hard byte-diff gate (§5.3); opt-in until proven.
- **Trimming `initialState` breaks first-navigation UX.** If a site relies on the full config being present at hydration for instant cross-page nav, trimming could add a load hop. *Mitigation:* the config loader already exposes lazy per-locale/per-page loading; verify the SPA path; keep an opt-out (`site.embedFullState: true`) if any site needs the old behavior.
- **Patching a minified dependency (Option E1) is brittle.** Anchors drift across vite-ssg releases. *Mitigation:* prefer D; if E1 is used as interim, make the patch idempotent + version-guarded like the lru-cache patch, and fail loudly if the anchor is missing.
- **Fleet drift.** Sites bump independently; some may lag on beta.31. *Mitigation:* per-site bump checklist in Phase 3; don't retire a site's stopgap until its sharded build is green.
- **Parallel shards inflate peak.** Rendering S shards concurrently multiplies peak by S. *Mitigation:* peak = `min(cores, S) × K × per-route`; make pool size and K configurable and set conservative defaults.

**Open questions**
1. **What exactly re-anchors each jsdom document to a GC root?** I proved *one document per route* is retained and that `close()` only recovers ~17 %, so the residual is held by a strong ref inside the vite-ssg/jsdom/unhead interplay that I did not name to a single variable. For Option D this doesn't matter (recycling frees it regardless). It **does** matter if we ever pursue an in-process fix (E2) — worth a focused dominator-tree pass or a bisect (e.g. does skipping `renderDOMHead` change the slope?).
2. **Is there a newer/patched `vite-ssg` that closes windows or bounds memory?** No off-the-shelf option surfaced (the ecosystem's standard answer is "raise the heap"). Check the vite-ssg tracker before investing in D; an upstream `renderSlice`/memory-bounded mode would let D become a thin shim.
3. **Choose `K` (routes/shard) and per-worker heap.** Trade build-time parallelism vs. peak. Suggest starting `K=100`, worker heap 2 GB, pool = `min(cores−1, 4)`; tune with the §5.1 harness.
4. **Does `site-bang`'s dynamic page generation change the route math?** Its `build:ssg` runs `generate:piece-pages` first; the true route count may exceed 24×15. Confirm before sizing its stop-loss.
5. **Should trimming `__INITIAL_STATE__` ship even if Track 2 makes it unnecessary for memory?** Recommendation: **yes** — it's a standalone SEO/payload win (81 %→~15 % of page), independent of the build fix.

---

## Appendix — reproduction & profiling harness

All of this ran against `site-peepoo` with the installed `vite-ssg` copy temporarily instrumented in `node_modules` (gitignored; reverted from a `.orig` backup afterward — no repo or dependency changed). Scripts live in this session's scratchpad; the essentials:

- **Instrumentation (env-gated, applied to `node_modules/vite-ssg/dist/shared/vite-ssg.*.mjs`):** override `PQueue` `concurrency`; optional `beasties` disable; optional `jsdom.window.close()`; per-route `process.memoryUsage()` log; optional `global.gc()` per route; optional `v8.writeHeapSnapshot()` at route N then `process.exit(0)`.
- **Decisive run:** `CMS_MEM_PROFILE=1 CMS_MEM_GC=1 CMS_SSG_CONCURRENCY=1 NODE_OPTIONS="--expose-gc --max-old-space-size=8192" node_modules/.bin/vite-ssg build` → the 6.05 MB/route post-GC curve (§1.3).
- **Snapshot:** same, plus `CMS_SNAPSHOT_AT=100` → `DocumentImpl = 101`, jsdom-class dominance, 687 MB retained (§1.4). Snapshot parsed with a custom buffer reader (file > Node's max string length) that aggregates node self-size by type/constructor and traces retaining paths via forward BFS from GC roots (weak edges excluded).
- **Falsification runs:** `CMS_JSDOM_CLOSE=1` (−17 %) and `CMS_SSG_NO_BEASTIES=1` (0 %) (§1.5).
- **Payload measurement:** `perl` extraction of `window.__INITIAL_STATE__` length vs. total page bytes on `dist/**/index.html` (§1.6).

To re-run cleanly: `nvm use` in the site dir first; the instrumentation is idempotent and always re-derives from the pristine `.orig` backup.
