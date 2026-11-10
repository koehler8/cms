# Change notes

Each change that ships to npm adds one note here. On the next push to `main`,
`.github/workflows/publish.yml` turns every note into the next version and a
`CHANGELOG.md` section, deletes the notes, tags `v<version>` and publishes
`@koehler8/cms`. No notes, no release.

A note is `.changes/<short-slug>.md`:

```md
---
bump: patch
section: Fixed
---
- **What changed, in one sentence.** Why it matters to a site, and anything a
  site must do when it updates.
```

- `bump`: `patch` (a fix, a dependency floor, nothing a site must change) or
  `minor` (a new feature or option, or a raised peer-dependency minimum). The
  release takes the largest bump among the pending notes. A `major` is refused:
  breaking releases are cut by hand.
- `section`: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`.
- The body is copied into `CHANGELOG.md` as written.

A change that ships nothing — tests, `builder/`, `tools/`, `docs/`, this
repo's own `CLAUDE.md` — needs no note.

Preview the next release: `node tools/release/release-from-changes.mjs plan`.
