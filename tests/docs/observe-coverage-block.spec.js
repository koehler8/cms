import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Spec + regression suite for the observe "blind spot" defect: the cms observe
// watermark froze at the 72h retention floor because neither observe pass emitted
// the coverage block the sweep reads to advance observeCoveredThrough. Both
// configured sources reported `degraded — pass 1 omitted the required coverage
// block`, so every sweep re-analyzed the same window and clamped at the floor.
//
// The fix must add a MANDATORY coverage-block instruction to each pass's doc —
// emitted on EVERY run (including a healthy zero-findings run) — that marks each
// configured source `covered` and states the window / through-timestamp the pass
// inspected, WITHOUT weakening either doc's read-only, defects-only,
// default-to-silence discipline.
//
// These docs are prose read by an LLM pass, not executable code — this content
// assertion is the only mechanism (mirroring tests/docs/readme.spec.js) that
// catches the instruction being absent or the discipline being rewritten out.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// rel path -> source it drives (per refine/decompose title-match).
const DOCS = {
  'builder/observe.md': 'observer-facet:cms',
  'builder/phases/observe.md': 'observer-brief:cms',
};

const CONTENT = {};

beforeAll(async () => {
  for (const rel of Object.keys(DOCS)) {
    CONTENT[rel] = await readFile(path.join(PROJECT_ROOT, rel), 'utf-8');
  }
});

// The coverage block is a NEW closing instruction. Slice from the first
// "coverage" mention to EOF so the semantic checks stay anchored to the new
// instruction and cannot pass on pre-existing prose elsewhere in the doc (e.g.
// the existing "zero findings" line already in observe.md's Boundaries section).
// When "coverage" is absent (the frozen state this defect is about), the slice
// is empty and every anchored assertion fails.
function coverageSection(doc) {
  const idx = doc.toLowerCase().indexOf('coverage');
  return idx === -1 ? '' : doc.slice(idx);
}

describe.each(Object.keys(DOCS))(
  '%s — mandatory coverage-block instruction',
  (rel) => {
    it(`names a coverage block and instructs marking the ${DOCS[rel]} sources covered`, () => {
      // AC-0737A5B0 / AC-C6A58B8D: the coverage-block instruction must exist and
      // mark each configured source `covered`.
      expect(CONTENT[rel]).toMatch(/coverage/i);
      const section = coverageSection(CONTENT[rel]);
      expect(section).toMatch(/\bcovered\b/i);
      expect(section).toMatch(/source/i);
    });

    it('mandates emitting the coverage block on EVERY run (not conditional on a finding)', () => {
      // AC-0737A5B0 / AC-C6A58B8D: "on every run" is what advances the watermark;
      // an instruction that only fires when something is found would re-freeze it.
      const section = coverageSection(CONTENT[rel]);
      expect(section).toMatch(
        /(every|each)\s+(run|sweep|pass|observe\w*)|always\s+emit|on\s+(every|each)\b/i,
      );
    });

    it('states the window / through-timestamp the pass inspected', () => {
      // AC-0737A5B0 / AC-C6A58B8D: the through-timestamp is the value the sweep
      // reads to advance observeCoveredThrough past 2026-08-12T04:06:32.707Z.
      const section = coverageSection(CONTENT[rel]);
      expect(section).toMatch(/window|through|timestamp|watermark|inspected/i);
    });

    it('preserves default-to-silence: reporting covered does not require or fabricate a finding', () => {
      // AC-53199321: covered-and-quiet is not a finding; the coverage block must
      // be emitted on a zero-findings sweep too.
      const section = coverageSection(CONTENT[rel]);
      expect(section).toMatch(
        /no\s+finding|without\b[^.\n]{0,40}finding|not\b[^.\n]{0,30}finding|does not require|neither requires|zero[-\s]?finding|quiet|even\b[^.\n]{0,30}(no|zero|healthy|quiet|nothing)/i,
      );
    });
  },
);

// Regression guards for the out-of-scope constraint (AC-53199321): the fix ADDS a
// coverage instruction and must NOT rewrite away each doc's existing read-only /
// defects-only / default-to-silence rails or the known-benign list. These pass
// today and must keep passing after the fix lands.
describe('observer discipline preserved verbatim (must not be rewritten out)', () => {
  it('builder/observe.md keeps its read-only rail and silence default', () => {
    const doc = CONTENT['builder/observe.md'];
    expect(doc).toMatch(/read-only/i);
    expect(doc).toMatch(/Default to silence/i);
    expect(doc).toMatch(/zero findings/i);
  });

  it('builder/phases/observe.md keeps read-only/defects-only/default-to-silence + known-benign list', () => {
    const doc = CONTENT['builder/phases/observe.md'];
    expect(doc).toMatch(/read-only, defects-only, default-to-silence/i);
    expect(doc).toMatch(/Known-benign/i);
  });
});
