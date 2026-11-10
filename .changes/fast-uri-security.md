---
bump: patch
section: Security
---
- **Patched `fast-uri` for GHSA-w74x-v6f9-j3xg and GHSA-xhq7-xmqj-769h.**
  cms's `ajv` accepts any `fast-uri ^3.0.1`, which let sites keep the
  vulnerable 3.1.8. cms now depends on `fast-uri ^3.1.9` directly, so a site
  that updates cms gets the patched copy. No code in cms imports it.
