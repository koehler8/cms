# Observer facet — Vertex CMS (cms)

> Sole member repo: this facet IS the composite observer's source map. Vertex CMS is a
> published library with no running service and no live URL — the sources below are the
> runner's own fresh clone plus network reads (the npm registry, its advisory database, and
> GitHub Actions). All read-only.

## Sources

1. **The runner's fresh clone of `cms`** (this working copy) — the primary source, no host
   state required:
   - `package.json` `version` — the source's intended version.
   - `git tag --list 'v*'` and `git log --oneline -20` — what has been tagged, and what landed
     since. A `v<version>` tag with no matching published version (source 2) is priority-1.
   - `CHANGELOG.md` — release headers vs `package.json` version (release-hygiene drift).
   - **`npm ci && npm test`** — safe to run and read-only in effect; this is how you detect a
     **red main** (priority 2). 45 test files / ~644 specs; a green run in ~3s is the healthy
     baseline. A failure is a finding — capture the failing spec name(s) and the tail.

2. **The npm registry** (network, read-only) — the published truth:
   - `npm view @koehler8/cms dist-tags --json` — the `beta` and `latest` pointers.
   - `npm view @koehler8/cms versions --json` — every published version.
   - Compare to the clone's `package.json` version and its `v*` tags: a tagged-but-unpublished
     version is the broken-release signal (priority 1).

3. **GitHub Actions — the publish workflow** (needs `gh` auth on the runner host; if `gh`
   is unauthenticated, say so rather than guessing):
   - `gh run list -R koehler8/cms --workflow publish.yml -L 10` — recent release runs.
   - `gh run view <id> -R koehler8/cms --log-failed` on a failed run — this is where the
     `NPM_TOKEN`-expiry **`E404` on the `PUT`** surfaces (the misleading-404 signature). Do not
     read or echo any token value that appears; redact and file the leak if one does.

4. **Consumer blast radius (secondary, only when a bad beta is suspected).** If priority-3
   evidence suggests a shipped beta is breaking sites, the symptom lives in the consumer sites'
   Amplify build logs — that is each site's own observer's lane. Confirm the framework is the
   cause (reproduces from the clone / the published beta, not the site's own config), file the
   **framework** defect, and do not enumerate per-site symptoms here.

5. **The dependency scanners — `builder/scanners/dependencies.mjs` and
   `builder/scanners/peer-ranges.mjs`** (both run in the clone and write nothing):
   - `dependencies.mjs` is buildmill's standard dependency scanner, carried byte for byte. Its
     network reads are `npm audit --json --package-lock-only` and `npm view <pkg> versions
     --json`. It files:
     - `dependency advisory:` — a security advisory anywhere in the lockfile. A critical or
       high advisory is high in the runtime tree (the packages every consumer installs with
       the framework) and medium in the dev-only tree; moderate is low, low is info. A
       runtime advisory is a framework defect (priority 4), filed once here rather than on
       every site.
     - `dependency update:` (info) — a newer stable release inside the installed major of a
       direct dependency, and `dependency major behind:` (low) — one or more majors behind.
       The dev dependencies are the versions every consumer site is tested against, so these
       stand as the scanner files them.
     - `dependency holds invalid:` — an entry in `builder/dependency-holds.json` without a
       package, a range or a reason; an invalid hold silences nothing. A hold with a reason
       silences updates while the installed version is inside its range, and an advisory
       only when its GHSA id is in `acceptedAdvisories`.
     - `dependency scanner blind:` — the lockfile, the audit or the registry could not be read,
       its negative control failed, or the scan ran out of its time budget. Treat that source
       as unread, never as clean.
   - `peer-ranges.mjs` is cms's own peer check; it reads only `package.json` and the lockfile.
     It files `dependency peer gap: <pkg> range excludes the tested version` (medium) when a
     `peerDependencies` range does not admit the devDependency version cms is tested against,
     `dependency peer gap: <pkg> admits untested N.x` (low) when the floor admits a major cms
     never tests, and `dependency peer range unreadable:` (low) for a range it refuses to
     guess at. Minor or patch spread under the floor is not a gap. A `peer-range scanner
     blind:` finding means `package.json` or the lockfile could not be read, or its negative
     control failed — treat that source as unread, never as clean.
   - The two scanners share no finding title.

## Read-only means read-only

Never `npm publish`, never `git tag`, never `git push`, never `gh workflow run` (do not trigger
the publish workflow), never edit `CHANGELOG.md`, `package.json`, or any source. The tempting
executables on this host are exactly the release levers — the publish trigger, `npm publish`,
`git tag`. The observer reports; releases come only from `publish.yml` on a merge to main.

## Boundaries

- Defects in the framework only: a broken release, a red main, a beta that breaks consumers, a
  security advisory in cms's own runtime dependency tree or a peer-range gap (and every other
  finding the two dependency scanners in source 5 file), or release-hygiene drift. Feature and
  refactor ideas are not findings.
- A newer release is filed only by the dependency scanner, as its own `dependency update:` or
  `dependency major behind:` finding at the scanner's severity. The observer's own passes never
  propose a bump and never file an `npm outdated` line themselves.
- Prerelease `beta.N` under the `beta` dist-tag and consumer sites on older pins are BY DESIGN —
  never findings.
- Severity asymmetry: broken publish / red main = high; a stale CHANGELOG line = low.
  Default to silence; a healthy framework produces zero findings.

## Coverage block

Every run — including a healthy run with zero findings — must close with a coverage block:
mark each configured source (the clone, the npm registry, GitHub Actions, and both dependency
scanners in source 5; note when the
consumer-blast-radius check in source 4 was skipped because no bad beta was suspected) as
covered, and state the window or through-timestamp this pass inspected. Emit this on every
run, not only when something is found — reporting a source covered does not require or
fabricate a finding, even when the sweep is quiet and finds nothing.
