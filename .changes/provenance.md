---
bump: patch
section: Fixed
---
- **Provenance names the right commit again.** 1.5.0's npm provenance pointed
  at the commit before its release commit, so npmjs.com showed "Unable to
  fetch the source commit". 1.5.1 has the same contents as 1.5.0, published
  from a run on its own release tag. Nothing for a site to change.
