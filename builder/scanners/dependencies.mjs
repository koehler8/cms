// Deterministic observe scanner: dependencies. It looks for security advisories
// and new releases of this repo's npm dependencies.
//
// Advisories are read with "npm audit --json --package-lock-only" over the whole
// lockfile. Updates cover direct dependencies only: every workspace
// package.json, checked against the registry's version list through
// "npm view <pkg> versions --json". The target is the highest release that is
// not a prerelease. The dist-tags are never read, because "latest" has pointed
// at betas before. No finding ever proposes a version below the installed one.
//
// Holds live in builder/dependency-holds.json, outside scanners/ so the runner
// never executes the file. It is a JSON array of
// { package, range, reason, acceptedAdvisories? }. While the installed version
// is inside "range" ("*", "N.x", "N.M.x" or an exact version), the package
// files no update finding. An advisory is silenced only when its GHSA id is
// listed in acceptedAdvisories. That is how a root with no fix is declared;
// any new advisory on a held package still files. A holds file that won't
// parse, or an entry without a reason, files a "holds invalid" finding and the
// entry is not honoured.
//
// Severity:
//   critical/high advisory, runtime (non-dev) tree   high
//   critical/high advisory, dev-only tree            medium
//   moderate advisory                                low
//   low advisory                                     info
//   one or more majors behind                        low
//   patch or minor behind                            info
// The dev-only tree is lockfile entries marked "dev": true. A devOptional entry
// (a dev dependency that a runtime package also pulls in as optional) counts as
// runtime: npm ci --omit=dev still installs it.
// Titles carry no counts or dates, so finding dedupe (product + title) keeps a
// dismissed finding quiet until something actually changes.
//
// Never silently blind. Every run first checks the classifier against a
// built-in fixture (the negative control below). It files a medium "dependency
// scanner blind" finding, never [], when that check disagrees, when the
// lockfile is missing, when npm audit or the registry can't be read, or when
// the time budget runs out. The budget sits under the runner's 120 s scanner
// timeout; BUILDMILL_DEPENDENCY_SCANNER_BUDGET_MS overrides it.
//
// Read-only and host-safe: it reads package-lock.json, the workspace
// package.json files and the holds file, asks npm only to audit the lockfile
// and read registry metadata, and writes nothing inside the clone.
//
// This file is the onboarding template: packages/core/src/onboarding.ts
// carries it byte for byte as DEPENDENCY_SCANNER_TEMPLATE, so keep it free of
// backticks and dollar-brace sequences.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_BUDGET_MS = 110000;
const envBudget = Number(process.env.BUILDMILL_DEPENDENCY_SCANNER_BUDGET_MS);
const BUDGET_MS = envBudget > 0 ? Math.min(envBudget, MAX_BUDGET_MS) : 90000;
const POOL = 6;
const LOCKFILE = "package-lock.json";
const HOLDS_FILE = join("builder", "dependency-holds.json");
const ADVISORY_BASE = "https://github.com/advisories/";

const abort = new AbortController();
let budgetHit = false;
const findings = [];
let repo = basename(process.cwd());

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

// The highest registry version above installed that is not a prerelease.
function stableTarget(installed, versions) {
  let best = null;
  for (const v of versions) {
    const p = parseVersion(v);
    if (!p || p.pre) continue;
    if (compareVersions(v, installed) !== 1) continue;
    if (best === null || compareVersions(v, best) === 1) best = v;
  }
  return best;
}

// --------------------------------------------------------------------- holds

// Raw holds JSON → { holds, problems }. An entry that fails validation is
// reported and dropped, never honoured.
function parseHolds(text) {
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

function advisorySeverity(level, runtime) {
  if (level === "critical" || level === "high") return runtime ? "high" : "medium";
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

// An "npm audit --json" (v2) report → findings. Only advisory objects count:
// a string in "via" is a package that merely inherits another's advisory.
function advisoryFindings(report, lockPackages, holds, repo) {
  const out = new Map();
  const installedOf = (name) => (lockPackages["node_modules/" + name] || {}).version || null;
  for (const [key, vuln] of Object.entries(report.vulnerabilities || {})) {
    if (!vuln || !Array.isArray(vuln.via)) continue;
    const nodes = Array.isArray(vuln.nodes) ? vuln.nodes : [];
    const entries = nodes.map((n) => lockPackages[n]);
    const versions = [...new Set(entries.filter((e) => e && e.version).map((e) => e.version))];
    // only "dev": true is dev-only; devOptional, and a node the lockfile doesn't
    // describe, count as runtime: louder, never quieter
    const runtime = entries.length === 0 || entries.some((e) => !e || !e.dev);
    for (const via of vuln.via) {
      if (!via || typeof via !== "object") continue;
      const pkg = typeof via.name === "string" && via.name ? via.name : key;
      const ghsa = ghsaOf(via);
      if (heldWithin(holds.filter((h) => h.accepted.includes(ghsa)), pkg, versions)) continue;
      const title = "dependency advisory: " + pkg + " " + ghsa + " (" + repo + ")";
      if (out.has(title)) continue;
      const level = String(via.severity || vuln.severity || "info");
      const range = String(via.range || "the vulnerable range");
      const fix = remedy(pkg, ghsa, range, vuln.fixAvailable, installedOf);
      const url = typeof via.url === "string" && via.url ? via.url : ADVISORY_BASE + ghsa;
      out.set(title, {
        title,
        severity: advisorySeverity(level, runtime),
        detail: pkg + " " + (versions.length ? versions.join(", ") : "(installed version unknown)") +
          " in the " + (runtime ? "runtime" : "dev-only") + " tree is affected by " + ghsa +
          " (" + level + "): " + String(via.title || "no title") + ". Vulnerable range: " + range + ". " + url + ". " + fix.detail,
        proposedChange: fix.proposed,
      });
    }
  }
  return [...out.values()];
}

// ------------------------------------------------------------------- updates

// One direct dependency against its registry version list → a finding or null.
function updateFinding(dep, versions, holds, repo) {
  if (heldWithin(holds, dep.name, [dep.installed])) return null;
  const target = stableTarget(dep.installed, versions);
  if (!target) return null;
  const cur = parseVersion(dep.installed);
  const next = parseVersion(target);
  const where = dep.where.join(", ");
  const detail = dep.name + " is installed at " + dep.installed + " (declared in " + where + "); the highest stable release on the registry is " +
    target + ". Prereleases and dist-tags are not considered.";
  const proposedChange = "Bump " + dep.name + " to " + target + " in " + where + ".";
  if (next.major > cur.major) {
    return { title: "dependency major behind: " + dep.name + " " + cur.major + ".x → " + next.major + ".x (" + repo + ")", severity: "low", detail, proposedChange };
  }
  return { title: "dependency update: " + dep.name + " (" + repo + ")", severity: "info", detail, proposedChange };
}

// Direct registry dependencies of every workspace the lockfile records: the
// root ("") and each local package path (no node_modules segment).
function directDependencies(lockPackages) {
  const deps = new Map();
  const dirs = Object.keys(lockPackages).filter((k) => !/(^|\/)node_modules\//.test(k) && !k.startsWith(".") && !k.startsWith("/"));
  for (const dir of dirs) {
    const manifestPath = dir ? join(dir, "package.json") : "package.json";
    let manifest = lockPackages[dir] || {};
    if (existsSync(manifestPath)) {
      try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { /* fall back to the lockfile's copy */ }
    }
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(manifest[field] || {})) {
        if (/^(file|link|workspace|git|git\+[a-z]+|github|https?):/.test(String(spec))) continue;
        const entry = (dir && lockPackages[dir + "/node_modules/" + name]) || lockPackages["node_modules/" + name];
        if (!entry || entry.link || !entry.version) continue;
        if (entry.resolved && !/^https?:/.test(entry.resolved)) continue;
        const lookup = typeof entry.name === "string" && entry.name ? entry.name : name;
        const key = lookup + "@" + entry.version;
        const dep = deps.get(key) || { name: lookup, installed: entry.version, where: [] };
        if (!dep.where.includes(manifestPath)) dep.where.push(manifestPath);
        deps.set(key, dep);
      }
    }
  }
  return [...deps.values()];
}

// ---------------------------------------------------------- negative control

// --- negative control
// A synthetic repo run through the same classifier every run. Every input
// advisory is critical, so only the expected verdicts below name high.
const CONTROL = {
  lock: {
    "node_modules/rt": { version: "1.0.0" },
    "node_modules/devdep": { version: "1.0.0", dev: true },
    "node_modules/devopt": { version: "1.0.0", devOptional: true },
    "node_modules/old": { version: "5.0.0" },
    "node_modules/held": { version: "1.0.0" },
  },
  audit: {
    vulnerabilities: {
      rt: { severity: "critical", nodes: ["node_modules/rt"], fixAvailable: true,
        via: [{ source: 1, name: "rt", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0001", severity: "critical", range: "<1.0.1" }] },
      devdep: { severity: "critical", nodes: ["node_modules/devdep"], fixAvailable: true,
        via: [{ source: 2, name: "devdep", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0002", severity: "critical", range: "<1.0.1" }] },
      devopt: { severity: "critical", nodes: ["node_modules/devopt"], fixAvailable: true,
        via: [{ source: 6, name: "devopt", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0006", severity: "critical", range: "<1.0.1" }] },
      old: { severity: "critical", nodes: ["node_modules/old"], fixAvailable: { name: "old", version: "4.9.0", isSemVerMajor: true },
        via: [{ source: 3, name: "old", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0003", severity: "critical", range: ">=5.0.0" }] },
      held: { severity: "critical", nodes: ["node_modules/held"], fixAvailable: false,
        via: [
          { source: 4, name: "held", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0004", severity: "critical", range: "<=1.0.0" },
          { source: 5, name: "held", title: "control", url: "https://github.com/advisories/GHSA-c0c0-0000-0005", severity: "critical", range: "<=1.0.0" },
        ] },
      parent: { severity: "critical", nodes: ["node_modules/parent"], fixAvailable: true, via: ["rt"] },
    },
  },
  holds: '[{ "package": "held", "range": "1.x", "reason": "control", "acceptedAdvisories": ["GHSA-c0c0-0000-0004"] }]',
  updates: [
    { dep: { name: "upd", installed: "1.0.0", where: ["package.json"] }, versions: ["1.0.0", "1.2.0", "1.3.0-rc.1"] },
    { dep: { name: "maj", installed: "1.0.0", where: ["package.json"] }, versions: ["1.0.0", "3.1.0", "4.0.0-beta.1"] },
    { dep: { name: "pre", installed: "1.0.0", where: ["package.json"] }, versions: ["0.9.0", "1.0.0", "2.0.0-beta.1"] },
    { dep: { name: "held", installed: "1.0.0", where: ["package.json"] }, versions: ["1.0.0", "1.1.0", "2.0.0"] },
  ],
  expect: [
    ["dependency advisory: rt GHSA-c0c0-0000-0001 (control)", "high"],
    ["dependency advisory: devdep GHSA-c0c0-0000-0002 (control)", "medium"],
    ["dependency advisory: devopt GHSA-c0c0-0000-0006 (control)", "high"],
    ["dependency advisory: old GHSA-c0c0-0000-0003 (control)", "high"],
    ["dependency advisory: held GHSA-c0c0-0000-0005 (control)", "high"],
    ["dependency major behind: maj 1.x → 3.x (control)", "low"],
    ["dependency update: upd (control)", "info"],
  ],
  downgrade: "dependency advisory: old GHSA-c0c0-0000-0003 (control)",
  neverProposed: ["4.9.0", "1.3.0-rc.1", "4.0.0-beta.1", "2.0.0-beta.1"],
};
// --- end negative control

function negativeControl() {
  const wrong = [];
  const { holds, problems } = parseHolds(CONTROL.holds);
  if (problems.length) wrong.push("the control hold was rejected: " + problems.map((p) => p.why).join("; "));
  const got = [
    ...advisoryFindings(CONTROL.audit, CONTROL.lock, holds, "control"),
    ...CONTROL.updates.map((u) => updateFinding(u.dep, u.versions, holds, "control")).filter(Boolean),
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

function blind(repo, cause, detail, proposedChange) {
  findings.push({
    title: "dependency scanner blind: " + cause + " (" + repo + ")",
    severity: "medium",
    detail,
    proposedChange: proposedChange || "Restore what the dependency scanner reads, so it can tell a clean tree from an unread one.",
  });
}

function run(cmd, args) {
  return new Promise((resolve) => {
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
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

const firstLine = (s) => String(s || "").trim().split("\n")[0].slice(0, 240);

async function repoName() {
  const origin = await run("git", ["remote", "get-url", "origin"]);
  const url = origin.code === 0 ? origin.stdout.trim() : "";
  if (url) {
    const last = url.replace(/\/+$/, "").split(/[/:]/).pop().replace(/\.git$/, "");
    if (last) return last;
  }
  const root = existsSync("package.json") ? parseJson(readFileSync("package.json", "utf8")) : undefined;
  if (root && typeof root.name === "string" && root.name) return root.name.split("/").pop();
  return basename(process.cwd());
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !abort.signal.aborted) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function audit(repo, lockPackages, holds) {
  const res = await run("npm", ["audit", "--json", "--package-lock-only"]);
  if (res.aborted) return;
  const report = parseJson(res.stdout);
  if (!report || typeof report !== "object" || report.error || !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    const why = report && report.error ? firstLine(report.error.summary || report.error.code) : firstLine(res.stderr) || "no audit report on stdout";
    blind(repo, "npm audit failed", "npm audit --json --package-lock-only exited " + res.code + " without a readable report: " + why,
      "Make npm audit reachable from the runner host (registry access, npm 7 or later), so advisories are read rather than assumed absent.");
    return;
  }
  findings.push(...advisoryFindings(report, lockPackages, holds, repo));
}

async function updates(repo, lockPackages, holds) {
  const deps = directDependencies(lockPackages);
  const names = [...new Set(deps.map((d) => d.name))];
  const failed = [];
  const versionsOf = new Map();
  await pool(names, POOL, async (name) => {
    const res = await run("npm", ["view", "--json", "--", name, "versions"]);
    if (res.aborted) return;
    const data = parseJson(res.stdout);
    if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
      if (data.error.code !== "E404") failed.push(name + ": " + firstLine(data.error.summary || data.error.code));
      return; // E404: not on the registry (a private package), nothing to compare
    }
    if (res.code !== 0 || data === undefined) {
      failed.push(name + ": " + (firstLine(res.stderr) || "exit " + res.code));
      return;
    }
    versionsOf.set(name, Array.isArray(data) ? data.map(String) : [String(data)]);
  });
  if (abort.signal.aborted) return;
  if (failed.length) {
    blind(repo, "registry unreachable", "npm view could not read registry versions for " + failed.length + " of " + names.length +
      " direct dependencies: " + failed.slice(0, 5).join("; "),
      "Make the npm registry reachable from the runner host, so updates are read rather than assumed absent.");
  }
  for (const dep of deps) {
    const versions = versionsOf.get(dep.name);
    if (!versions) continue;
    const f = updateFinding(dep, versions, holds, repo);
    if (f && !findings.some((g) => g.title === f.title)) findings.push(f);
  }
}

async function main() {
  repo = await repoName();
  const wrong = negativeControl();
  if (wrong.length) {
    blind(repo, "negative control failed", "The classifier disagrees with its built-in fixture, so its verdicts can't be trusted: " + wrong.slice(0, 8).join("; "),
      "Fix builder/scanners/dependencies.mjs until its negative control passes.");
  }
  if (!existsSync(LOCKFILE)) {
    blind(repo, "no package-lock.json", "There is no " + LOCKFILE + " at the repo root, so neither advisories nor installed versions can be read. A repo with no npm dependencies drops builder/scanners/dependencies.mjs instead.",
      "If the repo uses npm, commit " + LOCKFILE + " at the repo root; otherwise delete builder/scanners/dependencies.mjs and builder/dependency-holds.json.");
    return;
  }
  const lock = parseJson(readFileSync(LOCKFILE, "utf8"));
  if (!lock || typeof lock.packages !== "object" || lock.packages === null) {
    blind(repo, "package-lock.json unreadable", LOCKFILE + " does not parse, or has no \"packages\" map (lockfileVersion 2 or later is required).",
      "Regenerate " + LOCKFILE + " with npm 7 or later.");
    return;
  }
  let holds = [];
  if (existsSync(HOLDS_FILE)) {
    const parsed = parseHolds(readFileSync(HOLDS_FILE, "utf8"));
    holds = parsed.holds;
    for (const p of parsed.problems) {
      findings.push({
        title: "dependency holds invalid: " + p.key + " (" + repo + ")",
        severity: "medium",
        detail: HOLDS_FILE + ": " + p.why + ". Each hold is { package, range, reason, acceptedAdvisories? }, and an invalid hold silences nothing.",
        proposedChange: "Fix the entry in " + HOLDS_FILE + ", giving it a package, a range and a reason.",
      });
    }
  }
  await Promise.all([audit(repo, lock.packages, holds), updates(repo, lock.packages, holds)]);
  if (budgetHit) {
    blind(repo, "time budget exhausted", "The scan did not finish inside its " + BUDGET_MS + " ms budget, so its results are incomplete.",
      "Find out why npm audit or npm view is slow from the runner host.");
  }
}

const timer = setTimeout(() => { budgetHit = true; abort.abort(); }, BUDGET_MS);
main()
  .catch((err) => {
    findings.push({
      title: "dependency scanner blind: scanner error (" + repo + ")",
      severity: "medium",
      detail: "The dependency scanner threw: " + firstLine(err && err.stack ? err.stack : err),
      proposedChange: "Fix builder/scanners/dependencies.mjs.",
    });
  })
  .finally(() => {
    clearTimeout(timer);
    process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
  });
