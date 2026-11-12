#!/usr/bin/env node
// Test guard: fails when a change weakens the test suite instead of fixing code.
//
// Agents (and tired humans) hit a red check and take the cheapest road to green.
// This script looks at a diff and flags those roads:
//   1. the frozen v1 spec (tests/characterization.ts) changed
//   2. a test file was deleted
//   3. a test file that stayed lost assertions
//   4. tests were skipped/focused or a checker was silenced
//   5. unfinished code was added (todo!, unimplemented!, empty catch)
//   6. the test runner or this guard itself changed
// It also warns (does not fail) when program code loses require!/constraint checks.
//
// Usage:
//   node scripts/test-guard.js                  # staged changes (pre-commit)
//   node scripts/test-guard.js --base origin/main [--head HEAD]   # a commit range (CI)
//
// Overrides are deliberate and visible, never silent:
//   - Frozen spec edit: a commit trailer "Frozen-Change-Approved-By: Walter"
//     (or env RELICPAY_FROZEN_APPROVED=1 for a local pre-commit run).
//     Even when approved, the frozen spec may not lose assertions.
//   - Anything else: a commit trailer "Test-Guard-Override: <reason>"
//     (or env RELICPAY_TEST_GUARD_OVERRIDE="<reason>"). Findings are still printed.
//
// Exit codes: 0 clean (or only warnings / overridden), 1 findings, 2 usage or git error.

"use strict";

const { execFileSync } = require("child_process");

const FROZEN = ["tests/characterization.ts"];
const GUARD_FILES = ["scripts/test-guard.js", "scripts/test-guard-test.js", ".githooks/pre-commit"];
const RUNNER_FILES = ["scripts/test.js", "Anchor.toml", "tsconfig.json", "package.json", ".github/workflows/ci.yml"];
const IGNORED_PREFIXES = ["node_modules/", "target/", "app/node_modules/", ".next/"];

const isTestFile = (p) =>
  /^tests\//.test(p) ||
  /(^|\/)tests?\//.test(p) && /^programs\//.test(p) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
  /-test\.[cm]?js$/.test(p);
const isCode = (p) => /\.(rs|[cm]?[jt]sx?)$/.test(p);
const isRust = (p) => p.endsWith(".rs");
const isProgramSource = (p) => /^programs\/.*\.rs$/.test(p) && !isTestFile(p);

const ASSERT_PATTERNS = [
  /\bexpect\s*\(/g,
  /\bassert(\.\w+)?\s*\(/g,
  /\.should\b/g,
  /\b(debug_)?assert(_eq|_ne)?!\s*\(/g,
  /\.rejects?\b|\.to\.throw\b|\bshouldFail\b/g,
];
const PROGRAM_CHECK_PATTERNS = [/\brequire(_keys_eq|_eq|_neq|_gt|_gte|_keys_neq)?!\s*\(/g, /\bconstraint\s*=/g, /\bhas_one\s*=/g];

const ADDED_LINE_RULES = [
  { id: "skip-or-only", when: isTestFile, re: /\.(skip|only)\s*\(|\b(xit|xdescribe|xcontext)\s*\(|\bthis\.skip\s*\(\s*\)/, msg: "test skipped or focused (.skip / .only / xit / this.skip())" },
  { id: "rust-ignore", when: isRust, re: /#\[\s*ignore\b/, msg: "Rust test ignored (#[ignore])" },
  { id: "ts-suppress", when: (p) => /\.[cm]?[jt]sx?$/.test(p), re: /@ts-(ignore|nocheck|expect-error)\b|eslint-disable/, msg: "checker silenced (@ts-ignore / @ts-nocheck / eslint-disable)" },
  { id: "rust-allow", when: isProgramSource, re: /#!?\[\s*allow\s*\(/, msg: "lint silenced in program code (#[allow(...)])" },
  { id: "unfinished", when: isRust, re: /\b(todo|unimplemented)!\s*\(/, msg: "unfinished code (todo!/unimplemented!)" },
  { id: "empty-catch", when: (p) => /\.[cm]?[jt]sx?$/.test(p), re: /catch\s*(\([^)]*\))?\s*\{\s*\}/, msg: "empty catch swallows failures" },
  { id: "not-implemented", when: (p) => /\.[cm]?[jt]sx?$/.test(p), re: /throw new Error\(\s*["'`]not implemented/i, msg: "unimplemented stub" },
];

function git(args, opts = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
  } catch (err) {
    if (opts.allowFail) return null;
    const detail = err.stderr ? String(err.stderr).trim() : err.message;
    throw Object.assign(new Error(`git ${args.join(" ")} failed: ${detail}`), { code: 2 });
  }
}

function parseArgs(argv) {
  const out = { base: null, head: "HEAD", quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--head") out.head = argv[++i];
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw Object.assign(new Error(`unknown argument: ${a}`), { code: 2 });
  }
  if (out.base === undefined || out.head === undefined) throw Object.assign(new Error("--base/--head need a value"), { code: 2 });
  return out;
}

// Strip line comments so commented-out assertions do not count.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
function countMatches(src, patterns) {
  if (src == null) return 0;
  const clean = stripComments(src);
  return patterns.reduce((n, re) => n + (clean.match(re) || []).length, 0);
}

function readBlob(rev, path) {
  // rev === ":" means the index (staged content).
  const spec = rev === ":" ? `:${path}` : `${rev}:${path}`;
  return git(["show", spec], { allowFail: true });
}

function changedFiles(range) {
  const out = git(["diff", "--name-status", "-M", ...range]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0][0];
      if (status === "R" || status === "C") return { status, oldPath: parts[1], path: parts[2] };
      return { status, oldPath: parts[1], path: parts[1] };
    })
    .filter((f) => !IGNORED_PREFIXES.some((pre) => f.path.startsWith(pre)));
}

function addedLines(range, path) {
  const out = git(["diff", "-U0", "-M", ...range, "--", path], { allowFail: true }) || "";
  return out
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

function commitMessages(base, head) {
  if (!base) return "";
  return git(["log", "--format=%B", `${base}..${head}`], { allowFail: true }) || "";
}

function trailer(messages, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "mi");
  const m = messages.match(re);
  return m ? m[1].trim() : null;
}

function run(opts) {
  const staged = !opts.base;
  let baseRev, headRev, range;
  if (staged) {
    baseRev = "HEAD";
    headRev = ":";
    range = ["--cached"];
    if (git(["rev-parse", "--verify", "HEAD"], { allowFail: true }) === null) {
      baseRev = null; // first commit: nothing to compare against
    }
  } else {
    const mb = git(["merge-base", opts.base, opts.head]).trim();
    baseRev = mb;
    headRev = opts.head;
    range = [`${mb}`, `${opts.head}`];
  }

  const messages = commitMessages(baseRev && !staged ? baseRev : null, headRev);
  const frozenApproval = trailer(messages, "Frozen-Change-Approved-By") || (process.env.RELICPAY_FROZEN_APPROVED === "1" ? "env RELICPAY_FROZEN_APPROVED" : null);
  const override = trailer(messages, "Test-Guard-Override") || process.env.RELICPAY_TEST_GUARD_OVERRIDE || null;

  const findings = []; // { level: "fail"|"hard"|"warn", file, msg }
  const add = (level, file, msg) => findings.push({ level, file, msg });

  const files = baseRev ? changedFiles(range) : [];
  for (const f of files) {
    const oldSrc = f.status === "A" ? null : readBlob(baseRev, f.oldPath);
    const newSrc = f.status === "D" ? null : readBlob(headRev, f.path);

    // 1. Frozen spec
    if (FROZEN.includes(f.oldPath) || FROZEN.includes(f.path)) {
      const before = countMatches(oldSrc, ASSERT_PATTERNS);
      const after = countMatches(newSrc, ASSERT_PATTERNS);
      if (f.status === "D" || (f.status === "R" && !FROZEN.includes(f.path))) {
        add("hard", f.oldPath, "frozen v1 spec deleted or moved");
      } else if (after < before) {
        add("hard", f.path, `frozen v1 spec lost assertions (${before} -> ${after}); never allowed, even with approval`);
      } else if (!frozenApproval) {
        add("fail", f.path, `frozen v1 spec changed without "Frozen-Change-Approved-By:" trailer (assertions ${before} -> ${after})`);
      } else {
        add("warn", f.path, `frozen v1 spec changed, approved by: ${frozenApproval} (assertions ${before} -> ${after})`);
      }
      continue;
    }

    // 6. Guard and runner changes are loud
    if (GUARD_FILES.includes(f.path) || GUARD_FILES.includes(f.oldPath)) {
      // Adding the guard is fine; weakening or removing it must be loud.
      if (f.status !== "A") add("fail", f.path, "the test guard itself changed; needs a Test-Guard-Override trailer explaining why");
      continue; // its own source contains the patterns it looks for
    }
    if (RUNNER_FILES.includes(f.path) && f.status !== "A") {
      const lines = addedLines(range, f.path).join("\n");
      const removed = (git(["diff", "-U0", ...range, "--", f.path], { allowFail: true }) || "")
        .split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).join("\n");
      const touchesTests = /test|mocha|spec|guard/i.test(lines + removed);
      if (touchesTests) add("warn", f.path, "test runner configuration changed; check that every test file still runs");
    }

    if (!isCode(f.path)) continue;

    // 2. Deleted test file
    if (f.status === "D" && isTestFile(f.oldPath)) {
      add("fail", f.oldPath, "test file deleted");
      continue;
    }

    // 3. Assertions removed from a test file that stayed
    if (isTestFile(f.path) && oldSrc != null && newSrc != null) {
      const before = countMatches(oldSrc, ASSERT_PATTERNS);
      const after = countMatches(newSrc, ASSERT_PATTERNS);
      if (after < before) add("fail", f.path, `assertions removed (${before} -> ${after})`);
    }

    // Program checks removed (warning: refactors are legitimate, but look)
    if (isProgramSource(f.path) && oldSrc != null && newSrc != null) {
      const before = countMatches(oldSrc, PROGRAM_CHECK_PATTERNS);
      const after = countMatches(newSrc, PROGRAM_CHECK_PATTERNS);
      if (after < before) add("warn", f.path, `program checks decreased (require!/constraint/has_one ${before} -> ${after}); confirm none was a security check`);
    }

    // 4 and 5. Patterns on added lines
    if (f.status !== "D") {
      for (const line of addedLines(range, f.path)) {
        for (const rule of ADDED_LINE_RULES) {
          if (rule.when(f.path) && rule.re.test(line)) add("fail", f.path, `${rule.msg}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }

  return { findings, override, frozenApproval, fileCount: files.length, staged };
}

function report(result, quiet) {
  const { findings, override } = result;
  const hard = findings.filter((f) => f.level === "hard");
  const fails = findings.filter((f) => f.level === "fail");
  const warns = findings.filter((f) => f.level === "warn");
  const print = (tag, f) => console.log(`  ${tag} ${f.file}: ${f.msg}`);

  if (!quiet || findings.length) {
    console.log(`test-guard: checked ${result.fileCount} changed file(s) (${result.staged ? "staged" : "range"})`);
  }
  hard.forEach((f) => print("BLOCK", f));
  fails.forEach((f) => print(override ? "OVERRIDDEN" : "FAIL ", f));
  warns.forEach((f) => print("WARN ", f));

  if (hard.length) {
    console.log("test-guard: blocked. These cannot be overridden.");
    return 1;
  }
  if (fails.length && !override) {
    console.log("test-guard: failed. Fix the code instead of the tests, or add a");
    console.log('  "Test-Guard-Override: <reason>" trailer that Walter has agreed to.');
    return 1;
  }
  if (fails.length && override) console.log(`test-guard: passed with override: ${override}`);
  else if (warns.length) console.log(`test-guard: passed with ${warns.length} warning(s); read them before committing`);
  else if (!quiet) console.log("test-guard: clean");
  return 0;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log("usage: node scripts/test-guard.js [--base <ref>] [--head <ref>] [--quiet]");
      process.exit(0);
    }
    process.exit(report(run(opts), opts.quiet));
  } catch (err) {
    console.error(`test-guard: ${err.message}`);
    process.exit(2);
  }
}

module.exports = { run, report, countMatches, isTestFile };
