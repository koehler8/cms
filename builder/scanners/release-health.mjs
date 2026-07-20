// Observe scanner — release health for @koehler8/cms, the priority-1 observe
// failure mode (builder/phases/observe.md §1): a version is tagged in git but
// NOT installable from npm, so every consumer that needs the fix is blocked.
// This repo ships as source and has no test-CI — a failed `publish.yml` run
// goes unnoticed until a site tries to pull the beta. That silence is the lane.
//
// Two assertions, both computed from a git clone + one network read (no gh):
//   1. Every `v*` tag AT OR AFTER the first published version has a matching
//      published version on npm. A tagged-but-unpublished version = HIGH — the
//      documented NPM_TOKEN-expiry `E404`-on-PUT publish failure.
//   2. (hygiene, low) package.json version bumped strictly ahead of both the
//      last tag and the last published version, with no tag for it and the bump
//      not fresh (no release in flight) = a forgotten release.
//
// The floor in (1) is load-bearing: this package's FIRST publish was
// 1.0.0-beta.5, so the git tags v1.0.0-beta.1..4 predate npm and are BY DESIGN
// unpublished. Flooring at the earliest published version skips them — a naive
// "every tag must be published" check would file 4 false HIGH findings on a
// perfectly healthy repo. Likewise a published `beta.N` sits in the versions
// array regardless of dist-tag, so a beta under the `beta` (not `latest`)
// dist-tag never trips (1) — the two documented known-benigns need no special
// case, they fall out of the set logic.
//
// Read-only. Never publishes, tags, or reads any secret. npm/network failure is
// an ENVIRONMENT problem, never a framework defect — it retries twice then goes
// silent rather than filing a false finding (a real registry outage is the
// agent pass's / Actions-tab's lane, not this deterministic floor).
//
// Contract: pure JSON array of { title, detail, severity } on stdout, stderr
// for notes, exit 0. Empty array = healthy. Titles are STABLE (the backlog
// dedupes on exact title) — each unpublished version keys its own finding.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PKG_NAME = "@koehler8/cms";
const INFLIGHT_HOURS = 12; // a package.json bump newer than this = release likely in flight
const findings = [];

function silent(note) {
  process.stderr.write(`${note}\n`);
  console.log(JSON.stringify([]));
  process.exit(0);
}

// --- semver parse + precedence (dependency-free, per semver §11) ------------
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v).trim());
  if (!m) return null;
  return {
    raw: String(v).trim(),
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}
function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release outranks a prerelease
  if (b.length === 0) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers rank below alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1; // more identifiers outrank fewer
}
function semverCompare(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePre(a.prerelease, b.prerelease);
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8", timeout: 15_000 });
}

// --- gate: this must be the @koehler8/cms clone, in a git work tree ---------
let pkg;
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch {
  silent("no readable package.json in cwd — not the cms clone; silent");
}
if (pkg.name !== PKG_NAME) {
  silent(`cwd package is "${pkg.name ?? "(unnamed)"}", not ${PKG_NAME}; silent`);
}
const pkgVersion = String(pkg.version ?? "").trim();

if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  silent("not a git work tree — silent");
}

// --- collect v* tags (parsed; non-semver tags are skipped, not filed) -------
const tagOut = git(["tag", "--list", "v*"]);
const tags = (tagOut.stdout || "")
  .split("\n")
  .map((t) => t.trim())
  .filter((t) => t.startsWith("v"))
  .map((t) => {
    const parsed = parseSemver(t.slice(1));
    if (!parsed) process.stderr.write(`skipping non-semver tag ${t}\n`);
    return parsed ? { tag: t, version: parsed.raw, parsed } : null;
  })
  .filter(Boolean);

if (tags.length === 0) {
  silent("no v* semver tags — nothing to assert; silent");
}

// --- the one network read: published versions, 2-attempt retry --------------
function npmVersions(name) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    last = spawnSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8", timeout: 30_000 });
    if (last.status === 0) {
      try {
        const parsed = JSON.parse(last.stdout);
        return Array.isArray(parsed) ? parsed : [parsed]; // npm returns a bare string for a single version
      } catch (e) {
        process.stderr.write(`attempt ${attempt}: could not parse npm output: ${e.message}\n`);
      }
    } else {
      process.stderr.write(`attempt ${attempt}: npm view exited ${last.status ?? "timeout/spawn-fail"}${last.error ? ` (${last.error.message})` : ""}\n`);
    }
  }
  return null;
}

const published = npmVersions(PKG_NAME);
if (!published || published.length === 0) {
  // Registry unreachable / unparseable / empty. This is an environment problem,
  // not a framework defect — never file it. A genuine npm outage surfaces to the
  // agent pass and the Actions tab; the deterministic floor stays quiet.
  silent("npm view failed or returned no versions after 2 attempts — silent (environment, not a defect)");
}

const publishedSet = new Set(published);
const publishedParsed = published.map(parseSemver).filter(Boolean);
if (publishedParsed.length === 0) {
  silent("no parseable published versions — cannot establish a floor; silent");
}

// --- (1) tagged-but-unpublished at/after the first published version --------
const minPublished = publishedParsed.reduce((a, b) => (semverCompare(a, b) <= 0 ? a : b));
const unpublished = tags
  .filter((t) => semverCompare(t.parsed, minPublished) >= 0) // skip pre-first-publish history (v1.0.0-beta.1..4)
  .filter((t) => !publishedSet.has(t.version)); // tagged, but the version is not on the registry

for (const t of unpublished) {
  findings.push({
    title: `Release ${t.tag} tagged but not published to npm`,
    severity: "high",
    detail:
      `${t.tag} exists in git but ${t.version} is absent from \`npm view ${PKG_NAME} versions --json\`. ` +
      `The publish.yml run for this tag did not put the version on the registry. Because the framework ships as source under ~26 consumer sites, a \`^1.0.0-beta.N\` pin cannot resolve to it — every consumer that needs this release is blocked and nothing else surfaces it (no test-CI; a merged PR does not cut a release).\n\n` +
      `Most likely mechanism: NPM_TOKEN expiry — \`npm publish\` returns a MISLEADING \`E404\` on the \`PUT\` for an under-authorized scoped publish (npm answers 404, not 401). Rule out a transient registry blip first (the check already retried once).\n\n` +
      `Fix (the tag is already pushed — no re-tag): inspect the failed run on the Actions tab (\`gh run list -R koehler8/cms --workflow publish.yml\`); if it is the token, mint a classic Automation token (non-expiring, 2FA-bypass) at npmjs.com, \`gh secret set NPM_TOKEN --repo koehler8/cms\`, then \`gh run rerun <failed-run-id>\`. Never read or echo the token value.\n\n` +
      `Done-when: \`${t.version}\` appears in \`npm view ${PKG_NAME} versions --json\`.`,
  });
}

// --- (2) hygiene: version bumped ahead of the last release, none in flight --
const pkgParsed = parseSemver(pkgVersion);
const maxTag = tags.map((t) => t.parsed).reduce((a, b) => (semverCompare(a, b) >= 0 ? a : b));
const maxPublished = publishedParsed.reduce((a, b) => (semverCompare(a, b) >= 0 ? a : b));

if (
  pkgParsed &&
  semverCompare(pkgParsed, maxTag) > 0 &&
  semverCompare(pkgParsed, maxPublished) > 0 &&
  !tags.some((t) => t.version === pkgVersion) // a tag for it → that is assertion (1)'s lane, not hygiene
) {
  // Suppress if the bump looks in flight: bump → tag → push happens in one
  // session, so a package.json touched within INFLIGHT_HOURS may be mid-release.
  const ct = git(["log", "-1", "--format=%ct", "--", "package.json"]);
  const bumpEpoch = Number((ct.stdout || "").trim());
  const ageHours = Number.isFinite(bumpEpoch) && bumpEpoch > 0 ? (Date.now() / 1000 - bumpEpoch) / 3600 : Infinity;

  if (ageHours < INFLIGHT_HOURS) {
    process.stderr.write(`package.json at ${pkgVersion} is ahead but was touched ${ageHours.toFixed(1)}h ago — release likely in flight; not filing\n`);
  } else {
    let hasChangelog = false;
    try {
      const escaped = pkgVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      hasChangelog = new RegExp(`^#{1,3}\\s*v?${escaped}\\b`, "m").test(readFileSync("CHANGELOG.md", "utf8"));
    } catch {
      /* no CHANGELOG.md — reported as "not found" below */
    }
    findings.push({
      title: `package.json version ${pkgVersion} bumped ahead of the last release`,
      severity: "low",
      detail:
        `package.json is at ${pkgVersion}, ahead of the highest git tag (${maxTag.raw}) and the highest published npm version (${maxPublished.raw}), and no v${pkgVersion} tag exists. The bump was committed (last touched ${Number.isFinite(ageHours) ? `${ageHours.toFixed(0)}h ago` : "at an unknown time"}) but never tagged or published, so consumers cannot install it. ` +
        `A CHANGELOG.md entry for ${pkgVersion} is ${hasChangelog ? "present" : "MISSING"}.\n\n` +
        `If a release is actively being prepared this is expected and clears once v${pkgVersion} is tagged, pushed, and publish.yml succeeds. Otherwise the release was forgotten: confirm the CHANGELOG.md entry, \`git tag v${pkgVersion}\`, and push the tag.\n\n` +
        `Done-when: ${pkgVersion} is tagged and appears in \`npm view ${PKG_NAME} versions --json\` (or package.json is intentionally reverted).`,
    });
  }
}

console.log(JSON.stringify(findings));
