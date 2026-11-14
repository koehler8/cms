---
bump: patch
section: Fixed
---
- **Build inputs under `site/assets/` no longer ship in the public deploy.**
  The asset map's site glob emitted every file under `site/assets/` to
  `dist/assets/`, referenced or not, and base64-inlined small ones into the
  entry chunk every visitor downloads. That published each site's `_source/`
  folder (rasterize scripts, Pixelmator documents, SVG masters, generator
  output) at a public `/assets/` URL. The glob now skips any `_source/`
  directory at any depth, plus scripts (`.js`, `.mjs`, `.cjs`, `.ts`, `.sh`),
  notes (`.md`) and design documents (`.pxd`, `.psd`, `.ai`, `.sketch`,
  `.fig`, …) anywhere under `site/assets/`. Images, media and data files are
  unaffected, and no site needs to change anything; the old files drop out of
  the next build.
