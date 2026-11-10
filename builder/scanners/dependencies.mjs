// Observe scanner — dependency defects in @koehler8/cms's own tree
// (builder/phases/observe.md, priority 4). Every consumer site installs this
// package's runtime dependencies with the framework, so an advisory there is a
// framework defect, filed once here instead of once per site.
//
// Two checks, both computed from the clone's package.json and lockfile:
//   1. Security advisories in the RUNTIME tree. "npm audit --json
//      --package-lock-only" reads the whole lockfile; a vulnerable package
//      counts as dev-only, and files nothing, only when every lockfile node
//      for it is flagged "dev". "devOptional" stays runtime: npm itself keeps
//      it under --omit=dev, because a consumer reaches it through cms's
//      optional or peer dependencies. Only advisory objects in "via" file; a
//      string there is a package that merely inherits another's advisory.
//   2. Peer-range gaps. For each peerDependencies entry that is also a
//      devDependency, the version the lockfile resolves (what cms is developed
//      and tested against) is compared with the peer range:
//        the range does not admit the tested version        medium
//        the range admits a major below the tested major     low
//        the range or the version can't be read              low
//      Minor/patch spread under the floor is not a gap. The range reader
//      handles ^ ~ >= > <= < =, bare and partial versions, spaces and ||; it
//      refuses hyphen ranges, x wildcards and prereleases rather than guess.
//
// Outdated packages are never a finding: there is no update check, and an
// "npm outdated" line or a newer registry release files nothing.
//
// Holds live in builder/dependency-holds.json, outside scanners/ so the runner
// never executes the file: a JSON array of
// { package, range, reason, acceptedAdvisories? }. An advisory is silenced only
// when its GHSA id is in acceptedAdvisories and the installed version is inside
// "range" ("*", "N.x", "N.M.x" or an exact version) — that is how an advisory
// with no fixed release is declared. A holds file that won't parse, or an entry
// without a reason, files a "dependency holds invalid" finding and silences
// nothing.
//
// Severity of an advisory: critical/high → high, moderate → low, low → info.
//
// Never silently blind. Every run first checks the classifiers against a
// built-in fixture (the negative control below). It files a medium
// "dependency scanner blind" finding, never [], when that check disagrees,
// when package.json or the lockfile is missing or unreadable, when npm audit
// can't be read, or when the time budget runs out. The budget sits under the
// runner's 120 s scanner timeout; BUILDMILL_DEPENDENCY_SCANNER_BUDGET_MS
// overrides it.
//
// Speaks only for @koehler8/cms: in a clone whose package.json names another
// package it prints [] and says why on stderr.
//
// Read-only. It reads package.json, package-lock.json and the holds file, asks
// npm only to audit the lockfile, and writes nothing inside the clone.
//
// Contract: pure JSON array of { title, detail, severity, proposedChange } on
// stdout, stderr for notes, exit 0. Empty array = healthy. Titles carry no
// counts or dates, so finding dedupe (product + title) keeps a dismissed
// finding quiet until something actually changes.
//
// The classifiers (advisoryFindings, peerGapFindings, parseHolds) are exported
// behind a main-module guard, so tests/scripts/dependencyScanner.spec.js can
// import them without starting a scan.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_NAME = "@koehler8/cms";
const REPO = "cms";
const MAX_BUDGET_MS = 110000;
const DEFAULT_BUDGET_MS = 90000;
const LOCKFILE = "package-lock.json";
const HOLDS_FILE = join("builder", "dependency-holds.json");
const ADVISORY_BASE = "https://github.com/advisories/";

// ------------------------------------------------------------------ versions

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v).trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || "" } : null;
}

function comparePre(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] === undefined) return -1;
    if (bs[i] === undefined) return 1;
    const an = /^\d+$/.test(as[i]);
    const bn = /^\d+$/.test(bs[i]);
    if (an && bn && Number(as[i]) !== Number(bs[i])) return Number(as[i]) < Number(bs[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    if (!an && as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  }
  return 0;
}

// -1, 0 or 1; null when either side is not a plain semver version.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

// A hold's range: "*", "N", "N.x", "N.x.x", "N.M", "N.M.x" or an exact version.
// Returns a matcher, or null for anything else.
function rangeMatcher(range) {
  if (typeof range !== "string") return null;
  const r = range.trim();
  if (r === "*" || r === "x") return () => true;
  if (parseVersion(r)) return (v) => compareVersions(v, r) === 0;
  let m = /^(\d+)(?:\.[x*](?:\.[x*])?)?$/.exec(r);
  if (m) {
    const major = Number(m[1]);
    return (v) => { const p = parseVersion(v); return !!p && p.major === major; };
  }
  m = /^(\d+)\.(\d+)(?:\.[x*])?$/.exec(r);
  if (m) {
    const major = Number(m[1]);
    const minor = Number(m[2]);
    return (v) => { const p = parseVersion(v); return !!p && p.major === major && p.minor === minor; };
  }
  return null;
}

// ---------------------------------------------------------------- peer ranges

// [major, minor, patch] tuples, compared field by field.
function cmpTuple(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

// One comparator token → a list of bounds, each [">=", tuple] or ["<", tuple],
// over stable versions; [] for "*"; null for syntax this reader does not fully
// implement (hyphen ranges, x wildcards, prereleases).
function comparatorBounds(token) {
  if (token === "*") return [];
  const m = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/.exec(token);
  if (!m) return null;
  const op = m[1] || "=";
  const major = Number(m[2]);
  const hasMinor = m[3] !== undefined;
  const hasPatch = m[4] !== undefined;
  const minor = hasMinor ? Number(m[3]) : 0;
  const patch = hasPatch ? Number(m[4]) : 0;
  const base = [major, minor, patch];
  // the first version past the precision written: 8 → 9.0.0, 8.1 → 8.2.0, 8.1.2 → 8.1.3
  const next = !hasMinor ? [major + 1, 0, 0] : !hasPatch ? [major, minor + 1, 0] : [major, minor, patch + 1];
  switch (op) {
    case "^": {
      const upper = major > 0 || !hasMinor ? [major + 1, 0, 0] : minor > 0 || !hasPatch ? [0, minor + 1, 0] : [0, 0, patch + 1];
      return [[">=", base], ["<", upper]];
    }
    case "~":
      return [[">=", base], ["<", hasMinor ? [major, minor + 1, 0] : [major + 1, 0, 0]]];
    case ">=":
      return [[">=", base]];
    case ">":
      return [[">=", next]];
    case "<":
      return [["<", base]];
    case "<=":
      return [["<", next]];
    default:
      return [[">=", base], ["<", next]];
  }
}

// A peer range → a list of alternatives (the || parts), each a list of bounds
// that must all hold; null when any part is unreadable.
function parsePeerRange(range) {
  if (typeof range !== "string") return null;
  const alternatives = [];
  for (const part of range.split("||")) {
    const alt = part.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1");
    const bounds = [];
    if (alt !== "") {
      for (const token of alt.split(/\s+/)) {
        const b = comparatorBounds(token);
        if (!b) return null;
        bounds.push(...b);
      }
    }
    alternatives.push(bounds);
  }
  return alternatives;
}

const lowerOf = (bounds) =>
  bounds.filter(([op]) => op === ">=").map(([, t]) => t).reduce((a, t) => (cmpTuple(t, a) > 0 ? t : a), [0, 0, 0]);

const admits = (alternatives, tuple) =>
  alternatives.some((bounds) => bounds.every(([op, t]) => (op === ">=" ? cmpTuple(tuple, t) >= 0 : cmpTuple(tuple, t) < 0)));

// The lowest version any alternative admits, or null when none admits one.
function lowestAdmitted(alternatives) {
  let lowest = null;
  for (const bounds of alternatives) {
    const low = lowerOf(bounds);
    if (!admits([bounds], low)) continue; // an empty alternative, e.g. ">=9 <8"
    if (lowest === null || cmpTuple(low, lowest) < 0) lowest = low;
  }
  return lowest;
}

// package.json + the lockfile's "packages" map → peer-gap findings, at most one
// per peer. A peer with no devDependency (nothing cms tests against) is skipped.
export function peerGapFindings(packageJson, lockPackages, repo) {
  const out = [];
  const peers = packageJson && typeof packageJson.peerDependencies === "object" && packageJson.peerDependencies ? packageJson.peerDependencies : {};
  const dev = packageJson && typeof packageJson.devDependencies === "object" && packageJson.devDependencies ? packageJson.devDependencies : {};
  for (const [name, range] of Object.entries(peers)) {
    if (!Object.prototype.hasOwnProperty.call(dev, name)) continue;
    const entry = (lockPackages || {})["node_modules/" + name];
    if (!entry || typeof entry.version !== "string") continue;
    const tested = entry.version;
    const where = "package.json declares peer " + name + " " + JSON.stringify(range) + "; cms is developed and tested against " + name + " " + tested +
      " (devDependencies " + JSON.stringify(dev[name]) + ", resolved in " + LOCKFILE + ")";
    const v = parseVersion(tested);
    const alternatives = parsePeerRange(range);
    if (!v || v.pre || !alternatives) {
      const what = !alternatives ? "the peer range uses syntax this scanner does not read (hyphen ranges, x wildcards and prereleases are refused, not guessed at)" : "the tested version is not a plain stable semver version";
      out.push({
        title: "dependency peer range unreadable: " + name + " (" + repo + ")",
        severity: "low",
        detail: where + ", but " + what + ", so the peer contract can't be checked.",
        proposedChange: "Write peerDependencies " + name + " as ^, ~, >=, <, = or || comparators over full versions.",
      });
      continue;
    }
    const tuple = [v.major, v.minor, v.patch];
    if (!admits(alternatives, tuple)) {
      out.push({
        title: "dependency peer gap: " + name + " range excludes the tested version (" + repo + ")",
        severity: "medium",
        detail: where + ", which that range does not admit. Consumers are promised a " + name + " cms itself does not run on.",
        proposedChange: "Bring devDependencies " + name + " inside " + JSON.stringify(range) + ", or change peerDependencies " + name + " to admit " + tested + ".",
      });
      continue;
    }
    const lowest = lowestAdmitted(alternatives);
    if (lowest && lowest[0] < v.major) {
      out.push({
        title: "dependency peer gap: " + name + " admits untested " + lowest[0] + ".x (" + repo + ")",
        severity: "low",
        detail: where + ". The range's lowest admitted version is " + lowest.join(".") + ", major " + lowest[0] +
          ", so consumers may install a major (" + lowest[0] + ".x) that cms never tests against " + v.major + ".x.",
        proposedChange: "Raise the floor of peerDependencies " + name + " to ^" + v.major + ".0.0, or test cms against " + name + " " + lowest[0] + ".x.",
      });
    }
  }
  return out;
}

// --------------------------------------------------------------------- holds

// Raw holds JSON → { holds, problems }. An entry that fails validation is
// reported and dropped, never honoured.
export function parseHolds(text) {
  const problems = [];
  const holds = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    problems.push({ key: HOLDS_FILE, why: "the file does not parse as JSON (" + String(err.message).slice(0, 160) + ")" });
    return { holds, problems };
  }
  if (!Array.isArray(data)) {
    problems.push({ key: HOLDS_FILE, why: "the file must be a JSON array of { package, range, reason, acceptedAdvisories? }" });
    return { holds, problems };
  }
  data.forEach((h, i) => {
    const name = h && typeof h.package === "string" && h.package.trim() ? h.package.trim() : null;
    const key = name || "entry " + (i + 1);
    const why = [];
    if (!name) why.push("no package name");
    const match = h ? rangeMatcher(h.range) : null;
    if (!match) why.push("range " + JSON.stringify(h ? h.range : undefined) + " is not *, N.x, N.M.x or an exact version");
    if (!h || typeof h.reason !== "string" || !h.reason.trim()) why.push("no reason");
    const accepted = h && h.acceptedAdvisories !== undefined ? h.acceptedAdvisories : [];
    if (!Array.isArray(accepted) || !accepted.every((a) => typeof a === "string")) why.push("acceptedAdvisories must be an array of GHSA ids");
    if (why.length) {
      problems.push({ key, why: "the hold for " + key + " is not honoured: " + why.join("; ") });
      return;
    }
    holds.push({ package: name, range: h.range.trim(), match, accepted: accepted.map((a) => normGhsa(a.trim())) });
  });
  return { holds, problems };
}

function heldWithin(holds, name, versions) {
  return holds.find((h) => h.package === name && versions.length > 0 && versions.every((v) => h.match(v)));
}

// ---------------------------------------------------------------- advisories

// GHSA ids read as GitHub writes them: "GHSA-" then lowercase.
const normGhsa = (id) => (/^ghsa-/i.test(id) ? "GHSA-" + id.slice(5).toLowerCase() : id);

const ghsaOf = (via) => {
  const m = /GHSA(?:-[0-9a-z]{4}){3}/i.exec(String(via.url || ""));
  return m ? normGhsa(m[0]) : "npm-" + String(via.source);
};

function advisorySeverity(level) {
  if (level === "critical" || level === "high") return "high";
  if (level === "moderate") return "low";
  return "info";
}

// What to do about one advisory, from npm audit's fixAvailable. A fix that
// would move a package below its installed version is never proposed.
function remedy(pkg, ghsa, range, fix, installedOf) {
  const accept = "replace " + pkg + ", or accept " + ghsa + " in " + HOLDS_FILE + " with a reason";
  if (fix && typeof fix === "object" && typeof fix.name === "string" && typeof fix.version === "string") {
    const current = installedOf(fix.name);
    const cmp = current ? compareVersions(fix.version, current) : 1;
    if (cmp === -1) {
      return {
        detail: "npm audit's only fix moves " + fix.name + " below the installed " + current + ", a downgrade: no non-downgrade fix exists.",
        proposed: "No non-downgrade fix exists for " + pkg + " " + ghsa + "; " + accept + ".",
      };
    }
    if (cmp === null) {
      return {
        detail: "npm audit names a fix through " + fix.name + " that can't be compared with the installed version.",
        proposed: "Update " + pkg + " to a release outside " + range + ".",
      };
    }
    if (cmp === 0) {
      return {
        detail: "The installed " + fix.name + " " + current + " already allows a fixed " + pkg + "; the lockfile has to re-resolve it.",
        proposed: "Update the lockfile so " + pkg + " resolves outside " + range + " (" + fix.name + "@" + current + " allows it).",
      };
    }
    const major = fix.isSemVerMajor ? " (a semver-major change)" : "";
    const through = fix.name === pkg ? "" : ", which brings a fixed " + pkg;
    return {
      detail: "Fix: " + fix.name + " " + current + " → " + fix.version + major + ".",
      proposed: "Bump " + fix.name + " to " + fix.version + major + through + ".",
    };
  }
  if (fix === true) {
    return {
      detail: "A fixed release is reachable without a semver-major change.",
      proposed: "Update " + pkg + " to a release outside " + range + ".",
    };
  }
  return {
    detail: "No fixed release exists.",
    proposed: "No fixed release of " + pkg + " exists; " + accept + ".",
  };
}

// An "npm audit --json" (v2) report + the lockfile's "packages" map → findings
// for the runtime tree only. Only advisory objects count: a string in "via" is
// a package that merely inherits another's advisory.
export function advisoryFindings(report, lockPackages, holds, repo) {
  const out = new Map();
  const lock = lockPackages || {};
  const installedOf = (name) => (lock["node_modules/" + name] || {}).version || null;
  for (const [key, vuln] of Object.entries((report && report.vulnerabilities) || {})) {
    if (!vuln || !Array.isArray(vuln.via)) continue;
    const nodes = Array.isArray(vuln.nodes) ? vuln.nodes : [];
    const entries = nodes.map((n) => lock[n]);
    // a node the lockfile doesn't describe counts as runtime: louder, never quieter
    const runtime = entries.length === 0 || entries.some((e) => !e || e.dev !== true);
    if (!runtime) continue; // dev-only: never shipped to a consumer
    const versions = [...new Set(entries.filter((e) => e && e.version).map((e) => e.version))];
    for (const via of vuln.via) {
      if (!via || typeof via !== "object") continue;
      const pkg = typeof via.name === "string" && via.name ? via.name : key;
      const ghsa = ghsaOf(via);
      if (heldWithin((holds || []).filter((h) => h.accepted.includes(ghsa)), pkg, versions)) continue;
      const title = "dependency advisory: " + pkg + " " + ghsa + " (" + repo + ")";
      if (out.has(title)) continue;
      const level = String(via.severity || vuln.severity || "info");
      const range = String(via.range || "the vulnerable range");
      const fix = remedy(pkg, ghsa, range, vuln.fixAvailable, installedOf);
      const url = typeof via.url === "string" && via.url ? via.url : ADVISORY_BASE + ghsa;
      out.set(title, {
        title,
        severity: advisorySeverity(level),
        detail: pkg + " " + (versions.length ? versions.join(", ") : "(installed version unknown)") +
          " in the runtime tree (installed by every consumer) is affected by " + ghsa +
          " (" + level + "): " + String(via.title || "no title") + ". Vulnerable range: " + range + ". " + url + ". " + fix.detail,
        proposedChange: fix.proposed,
      });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------- negative control

// A synthetic repo run through the same classifiers every run. Every input
// advisory is critical, so only the runtime verdicts below name high.
const CONTROL = {
  lock: {
    "node_modules/rt": { version: "1.0.0" },
    "node_modules/devdep": { version: "1.0.0", dev: true },
    "node_modules/devopt": { version: "1.0.0", devOptional: true },
    "node_modules/old": { version: "5.0.0" },
    "node_modules/held": { version: "1.0.0" },
    "node_modules/same": { version: "1.4.0", dev: true },
    "node_modules/wide": { version: "2.0.0", dev: true },
    "node_modules/behind": { version: "2.0.5", dev: true },
    "node_modules/hyphen": { version: "1.5.0", dev: true },
  },
  audit: {
    vulnerabilities: {
      rt: { severity: "critical", nodes: ["node_modules/rt"], fixAvailable: true,
        via: [{ source: 1, name: "rt", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0001", severity: "critical", range: "<1.0.1" }] },
      devdep: { severity: "critical", nodes: ["node_modules/devdep"], fixAvailable: true,
        via: [{ source: 2, name: "devdep", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0002", severity: "critical", range: "<1.0.1" }] },
      old: { severity: "critical", nodes: ["node_modules/old"], fixAvailable: { name: "old", version: "4.9.0", isSemVerMajor: true },
        via: [{ source: 3, name: "old", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0003", severity: "critical", range: ">=5.0.0" }] },
      held: { severity: "critical", nodes: ["node_modules/held"], fixAvailable: false,
        via: [
          { source: 4, name: "held", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0004", severity: "critical", range: "<=1.0.0" },
          { source: 5, name: "held", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0005", severity: "critical", range: "<=1.0.0" },
        ] },
      devopt: { severity: "critical", nodes: ["node_modules/devopt"], fixAvailable: true,
        via: [{ source: 6, name: "devopt", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0006", severity: "critical", range: "<1.0.1" }] },
      parent: { severity: "critical", nodes: ["node_modules/parent"], fixAvailable: true, via: ["rt"] },
    },
  },
  holds: '[{ "package": "held", "range": "1.x", "reason": "control", "acceptedAdvisories": ["GHSA-c0c0-0000-0004"] }]',
  pkg: {
    devDependencies: { same: "^1.4.0", wide: "^2.0.0", behind: "^2.0.0", hyphen: "^1.5.0" },
    peerDependencies: { same: "^1.0.0", wide: "^1.0.0 || ^2.0.0", behind: "^2.1.0", hyphen: "1.0.0 - 2.0.0", untested: "^1.0.0" },
  },
  expect: [
    ["dependency advisory: rt GHSA-c0c0-0000-0001 (control)", "high"],
    ["dependency advisory: devopt GHSA-c0c0-0000-0006 (control)", "high"],
    ["dependency advisory: old GHSA-c0c0-0000-0003 (control)", "high"],
    ["dependency advisory: held GHSA-c0c0-0000-0005 (control)", "high"],
    ["dependency peer gap: wide admits untested 1.x (control)", "low"],
    ["dependency peer gap: behind range excludes the tested version (control)", "medium"],
    ["dependency peer range unreadable: hyphen (control)", "low"],
  ],
  downgrade: "dependency advisory: old GHSA-c0c0-0000-0003 (control)",
  neverProposed: ["4.9.0"],
};

function negativeControl() {
  const wrong = [];
  const { holds, problems } = parseHolds(CONTROL.holds);
  if (problems.length) wrong.push("the control hold was rejected: " + problems.map((p) => p.why).join("; "));
  const got = [
    ...advisoryFindings(CONTROL.audit, CONTROL.lock, holds, "control"),
    ...peerGapFindings(CONTROL.pkg, CONTROL.lock, "control"),
  ];
  const seen = got.map((f) => f.title + " = " + f.severity).sort();
  const want = CONTROL.expect.map(([t, s]) => t + " = " + s).sort();
  for (const w of want) if (!seen.includes(w)) wrong.push("expected " + w);
  for (const s of seen) if (!want.includes(s)) wrong.push("did not expect " + s);
  const down = got.find((f) => f.title === CONTROL.downgrade);
  if (down && !/no non-downgrade fix/i.test(down.proposedChange)) wrong.push("the downgrade-only advisory does not say there is no non-downgrade fix");
  for (const f of got) {
    for (const v of CONTROL.neverProposed) {
      if ((f.title + "\n" + f.proposedChange).includes(v)) wrong.push(f.title + " proposes " + v);
    }
  }
  return wrong;
}

// ------------------------------------------------------------------- the run

function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

const firstLine = (s) => String(s || "").trim().split("\n")[0].slice(0, 240);

async function main() {
  const findings = [];
  const abort = new AbortController();
  const envBudget = Number(process.env.BUILDMILL_DEPENDENCY_SCANNER_BUDGET_MS);
  const budgetMs = envBudget > 0 ? Math.min(envBudget, MAX_BUDGET_MS) : DEFAULT_BUDGET_MS;
  let budgetHit = false;
  const timer = setTimeout(() => { budgetHit = true; abort.abort(); }, budgetMs);

  const blind = (cause, detail, proposedChange) => {
    findings.push({
      title: "dependency scanner blind: " + cause + " (" + REPO + ")",
      severity: "medium",
      detail,
      proposedChange: proposedChange || "Restore what the dependency scanner reads, so it can tell a clean tree from an unread one.",
    });
  };

  const run = (cmd, args) => new Promise((resolve) => {
    if (abort.signal.aborted) return resolve({ aborted: true, code: null, stdout: "", stderr: "" });
    execFile(cmd, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      signal: abort.signal,
      env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false" },
    }, (err, stdout, stderr) => {
      if (abort.signal.aborted) return resolve({ aborted: true, code: null, stdout: "", stderr: "" });
      const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
      resolve({ aborted: false, code, stdout: stdout || "", stderr: String(stderr || (err && err.message) || "") });
    });
  });

  const scan = async () => {
    const pkg = existsSync("package.json") ? parseJson(readFileSync("package.json", "utf8")) : undefined;
    if (!pkg || typeof pkg !== "object") {
      blind("package.json unreadable", "There is no readable package.json at the repo root, so the scanner can't tell which package it is reading.",
        "Run the scanner from the root of the cms clone.");
      return;
    }
    if (pkg.name !== PKG_NAME) {
      process.stderr.write("dependencies: package.json names " + JSON.stringify(pkg.name) + ", not " + PKG_NAME + "; this scanner speaks only for cms\n");
      return;
    }
    const wrong = negativeControl();
    if (wrong.length) {
      blind("negative control failed", "The classifiers disagree with their built-in fixture, so their verdicts can't be trusted: " + wrong.slice(0, 8).join("; "),
        "Fix builder/scanners/dependencies.mjs until its negative control passes.");
    }
    if (!existsSync(LOCKFILE)) {
      blind("no package-lock.json", "There is no " + LOCKFILE + " at the repo root, so neither advisories nor tested versions can be read.",
        "Commit " + LOCKFILE + " at the repo root.");
      return;
    }
    const lock = parseJson(readFileSync(LOCKFILE, "utf8"));
    if (!lock || typeof lock.packages !== "object" || lock.packages === null) {
      blind("package-lock.json unreadable", LOCKFILE + " does not parse, or has no \"packages\" map (lockfileVersion 2 or later is required).",
        "Restore " + LOCKFILE + " from main; regenerate it only under the pinned npm (root CLAUDE.md, \"Lockfile and npm version\").");
      return;
    }
    let holds = [];
    if (existsSync(HOLDS_FILE)) {
      const parsed = parseHolds(readFileSync(HOLDS_FILE, "utf8"));
      holds = parsed.holds;
      for (const p of parsed.problems) {
        findings.push({
          title: "dependency holds invalid: " + p.key + " (" + REPO + ")",
          severity: "medium",
          detail: HOLDS_FILE + ": " + p.why + ". Each hold is { package, range, reason, acceptedAdvisories? }, and an invalid hold silences nothing.",
          proposedChange: "Fix the entry in " + HOLDS_FILE + ", giving it a package, a range and a reason.",
        });
      }
    }
    findings.push(...peerGapFindings(pkg, lock.packages, REPO));
    const res = await run("npm", ["audit", "--json", "--package-lock-only"]);
    if (res.aborted) return;
    const report = parseJson(res.stdout);
    if (!report || typeof report !== "object" || report.error || !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
      const why = report && report.error ? firstLine(report.error.summary || report.error.code) : firstLine(res.stderr) || "no audit report on stdout";
      blind("npm audit failed", "npm audit --json --package-lock-only exited " + res.code + " without a readable report: " + why,
        "Make npm audit reachable from the runner host (registry access, npm 7 or later), so advisories are read rather than assumed absent.");
      return;
    }
    findings.push(...advisoryFindings(report, lock.packages, holds, REPO));
  };

  try {
    await scan();
    if (budgetHit) {
      blind("time budget exhausted", "The scan did not finish inside its " + budgetMs + " ms budget, so its results are incomplete.",
        "Find out why npm audit is slow from the runner host.");
    }
  } catch (err) {
    blind("scanner error", "The dependency scanner threw: " + firstLine(err && err.stack ? err.stack : err), "Fix builder/scanners/dependencies.mjs.");
  } finally {
    clearTimeout(timer);
    process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
  }
}

// Main-module guard, compared by real path: the runner may reach the clone
// through a symlink (macOS /tmp is /private/tmp), and a guard that misses
// would print nothing at all — a silently blind scanner.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
