// Observe scanner: peer-range gaps in @koehler8/cms's own package.json (builder/phases/observe.md,
// priority 4). It sits beside builder/scanners/dependencies.mjs, buildmill's standard scanner kept
// byte for byte, which has no peer check; no title here is one that scanner files.
// Per peerDependencies entry that is also a devDependency, against the version the lockfile resolves:
// range excludes it → medium; range admits a lower untested major → low; range or version
// unreadable → low (hyphen ranges, x wildcards and prereleases are refused, not guessed at).
// Minor/patch spread is not a gap. A built-in negative control checks the classifier every run;
// a failed control, or a missing or unreadable package.json or lockfile, files a medium
// "peer-range scanner blind" finding, never []. Speaks only for @koehler8/cms (else [] + a stderr note).
// Read-only, no network. Contract: JSON array of { title, detail, severity, proposedChange } on
// stdout, exit 0; titles carry no counts or dates. peerGapFindings is exported behind a
// main-module guard, so tests can import it without starting a scan.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG_NAME = "@koehler8/cms";
const REPO = "cms";
const LOCKFILE = "package-lock.json";

// ------------------------------------------------------------------ versions

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v).trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || "" } : null;
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

// ---------------------------------------------------------- negative control

// Run through the same classifier every scan: one peer per verdict; "same" (minor
// spread) and "untested" (no devDependency) must file nothing.
const CONTROL = {
  lock: {
    "node_modules/same": { version: "1.4.0", dev: true },
    "node_modules/wide": { version: "2.0.0", dev: true },
    "node_modules/behind": { version: "2.0.5", dev: true },
    "node_modules/hyphen": { version: "1.5.0", dev: true },
  },
  pkg: {
    devDependencies: { same: "^1.4.0", wide: "^2.0.0", behind: "^2.0.0", hyphen: "^1.5.0" },
    peerDependencies: { same: "^1.0.0", wide: "^1.0.0 || ^2.0.0", behind: "^2.1.0", hyphen: "1.0.0 - 2.0.0", untested: "^1.0.0" },
  },
  expect: [
    ["dependency peer gap: wide admits untested 1.x (control)", "low"],
    ["dependency peer gap: behind range excludes the tested version (control)", "medium"],
    ["dependency peer range unreadable: hyphen (control)", "low"],
  ],
};

function negativeControl() {
  const wrong = [];
  const seen = peerGapFindings(CONTROL.pkg, CONTROL.lock, "control").map((f) => f.title + " = " + f.severity).sort();
  const want = CONTROL.expect.map(([t, s]) => t + " = " + s).sort();
  for (const w of want) if (!seen.includes(w)) wrong.push("expected " + w);
  for (const s of seen) if (!want.includes(s)) wrong.push("did not expect " + s);
  return wrong;
}

// ------------------------------------------------------------------- the run

function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

const firstLine = (s) => String(s || "").trim().split("\n")[0].slice(0, 240);

function main() {
  const findings = [];

  const blind = (cause, detail, proposedChange) => {
    findings.push({
      title: "peer-range scanner blind: " + cause + " (" + REPO + ")",
      severity: "medium",
      detail,
      proposedChange: proposedChange || "Restore what the peer-range scanner reads, so it can tell a clean peer contract from an unread one.",
    });
  };

  const scan = () => {
    const pkg = existsSync("package.json") ? parseJson(readFileSync("package.json", "utf8")) : undefined;
    if (!pkg || typeof pkg !== "object") {
      blind("package.json unreadable", "There is no readable package.json at the repo root, so neither the peer ranges nor the devDependencies can be read.",
        "Run the scanner from the root of the cms clone.");
      return;
    }
    if (pkg.name !== PKG_NAME) {
      process.stderr.write("peer-ranges: package.json names " + JSON.stringify(pkg.name) + ", not " + PKG_NAME + "; this scanner speaks only for cms\n");
      return;
    }
    const wrong = negativeControl();
    if (wrong.length) {
      blind("negative control failed", "The peer classifier disagrees with its built-in fixture, so its verdicts can't be trusted: " + wrong.slice(0, 8).join("; "),
        "Fix builder/scanners/peer-ranges.mjs until its negative control passes.");
    }
    if (!existsSync(LOCKFILE)) {
      blind("no package-lock.json", "There is no " + LOCKFILE + " at the repo root, so the versions cms is tested against can't be read.",
        "Commit " + LOCKFILE + " at the repo root.");
      return;
    }
    const lock = parseJson(readFileSync(LOCKFILE, "utf8"));
    if (!lock || typeof lock.packages !== "object" || lock.packages === null) {
      blind("package-lock.json unreadable", LOCKFILE + " does not parse, or has no \"packages\" map (lockfileVersion 2 or later is required).",
        "Restore " + LOCKFILE + " from main; regenerate it only under the pinned npm (root CLAUDE.md, \"Lockfile and npm version\").");
      return;
    }
    findings.push(...peerGapFindings(pkg, lock.packages, REPO));
  };

  try {
    scan();
  } catch (err) {
    blind("scanner error", "The peer-range scanner threw: " + firstLine(err && err.stack ? err.stack : err), "Fix builder/scanners/peer-ranges.mjs.");
  } finally {
    process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
  }
}

// Compared by real path: the clone may sit behind a symlink (macOS /tmp), and a
// guard that misses would print nothing at all — a silently blind scanner.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
