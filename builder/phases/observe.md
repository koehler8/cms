# Observe brief — Vertex CMS (product level)

Vertex CMS is a **published npm library, not a running service**: there is no live URL, no
GA4/GSC, no daemon. Its "outcomes" are releases and the health of the tip of main. It also has
no test-running CI — the `publish.yml` workflow only publishes on a tag, so a red main or a
broken release can slip silently until a consumer site tries to pull it. That silence is
exactly your lane. "Quiet" means: main is green, the published `beta` dist-tag matches the
tagged source, and no consumer is failing to build against the framework.

Priorities, in order (most-critical first):

1. **Broken or missing release.** The single highest-severity failure mode. A `v*` tag exists
   (or `package.json` version was bumped) but the version is **not on npm** — the `publish.yml`
   run failed. The documented signature is a **misleading `E404` on the `PUT`** when the
   `NPM_TOKEN` secret has expired (npm returns 404, not 401, for an under-authorized scoped
   publish). If a fix or feature is tagged but not installable, every consumer that needs it is
   blocked. HIGH. Name the mechanism (token expiry vs transient) and the fix
   (rotate `NPM_TOKEN` → `gh run rerun <id>`; the tag is already pushed, no re-tag needed).

2. **Red main.** `npm ci && npm test` failing on the tip of the default branch. With no
   test-CI, main can go red and stay red unnoticed until a PR's verify gate catches it. Because
   this repo ships as source (consumers install from it), a red main is a latent fleet defect.
   HIGH. Investigate: which spec(s), since which commit, and what changed.

3. **A shipped beta breaking consumers.** The blast-radius signal — a published beta that fails
   consumer builds (image-variant pipeline, virtual modules, a breaking change that escaped the
   suite). The *symptom* lives in consumer-site Amplify logs, which are each site's own
   observer's lane — **file the framework defect (the bad beta), not the site symptom**, and
   only when the evidence points at the framework, not the consumer's own config.

4. **Release-hygiene drift.** Lower severity: a version bumped without a `CHANGELOG.md` entry, a
   tag with no publish, a publish with no matching `CHANGELOG` header, or `package.json` version
   ahead of both the last tag and the last published version with no release in flight. File
   conservatively — this is housekeeping, not an outage.

Data-access rail: **read-only, defects-only, default-to-silence.** This is a code framework
(published, not personal data) — no content-sensitivity rule applies. The one absolute
exclusion is credentials: never read or echo `NPM_TOKEN`, any `.env`, or any secret value; if a
secret ever surfaces in log or workflow output, redact it in your output and file the leak
itself as a high-severity finding.

Known-benign — never file:
- **Prerelease `beta.N` versions published under the `beta` dist-tag** (not `latest`) — that is
  the deliberate release model, not a "missing from latest" defect.
- **Consumer sites lagging behind the current beta** — each site bumps `@koehler8/cms` on its
  own schedule; an old pin is by design, never a finding.
- **The lru-cache postinstall patch mutating `node_modules/**/lru-cache`** — load-bearing Node-20
  compat, by design.
- **No `npm outdated` / dependency proposals** — deps are Chris's supervised call
  (`product.md` Dependency posture); do not file dependency findings as observer defects.

Boundaries — defects only, proposals are the product agent's lane. Don't re-file what is already
visible on the repo's Actions tab if a release just happened and Chris is watching it. Severity
asymmetry: broken publish or red main = high; a stale CHANGELOG line or a doc drift = low —
investigate hard, file conservatively. Zero findings on a healthy day is the expected outcome.

## Coverage block

Every run — including a healthy zero-findings day — must close with a coverage block: mark
each source this brief covers as covered, and state the window or through-timestamp
inspected. Emit this on every run, not only when a priority-level finding turns up —
reporting coverage does not require or fabricate a finding, even on a quiet, healthy sweep.
