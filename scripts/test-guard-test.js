#!/usr/bin/env node
// Self-tests for scripts/test-guard.js. Each case builds a throwaway git repo,
// makes one change, and checks the guard's verdict. No network, no validator.
//   node scripts/test-guard-test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const GUARD = path.join(__dirname, "test-guard.js");

const BASE_FILES = {
  "tests/characterization.ts": [
    'describe("v1", () => {',
    '  it("a", async () => { await sleep(1000); expect(x).to.equal(1); });',
    '  it("b", async () => { assert.ok(y); });',
    "});",
  ].join("\n"),
  "tests/v2-features.ts": [
    'describe("v2", () => {',
    '  it("c", () => { expect(a).to.equal(1); expect(b).to.equal(2); });',
    "});",
  ].join("\n"),
  "programs/relicpay/src/instructions/repay.rs": [
    "pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {",
    "    require!(amount > 0, RelicPayError::ZeroAmount);",
    "    require_keys_eq!(ctx.accounts.owner.key(), ctx.accounts.agreement.buyer);",
    "    Ok(())",
    "}",
  ].join("\n"),
  "app/lib/client.ts": "export async function load() {\n  try { return await f(); } catch (e) { throw e; }\n}\n",
};

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-"));
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["config", "user.email", "guard@test.local"]);
  sh(dir, "git", ["config", "user.name", "guard-test"]);
  sh(dir, "git", ["config", "commit.gpgsign", "false"]);
  for (const [p, c] of Object.entries(BASE_FILES)) write(dir, p, c);
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "base"]);
  return dir;
}

function write(dir, p, content) {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), content);
}
function edit(dir, p, fn) {
  write(dir, p, fn(fs.readFileSync(path.join(dir, p), "utf8")));
}

function guard(dir, args = [], env = {}) {
  const r = spawnSync("node", [GUARD, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, RELICPAY_FROZEN_APPROVED: "", RELICPAY_TEST_GUARD_OVERRIDE: "", ...env },
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// Stage a change and run the guard in pre-commit mode.
function staged(change, env) {
  const dir = makeRepo();
  change(dir);
  sh(dir, "git", ["add", "-A"]);
  return guard(dir, [], env);
}

// Commit a change with a message and run the guard in range mode (CI).
function committed(change, message) {
  const dir = makeRepo();
  change(dir);
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", message]);
  return guard(dir, ["--base", "HEAD~1"]);
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// Clean changes pass.
test("clean: new test with assertions passes", () => {
  const r = staged((d) => write(d, "tests/new-feature.ts", 'it("x", () => { expect(1).to.equal(1); });'));
  assert.strictEqual(r.code, 0, r.out);
});
test("clean: adding assertions to an existing test passes", () => {
  const r = staged((d) => edit(d, "tests/v2-features.ts", (s) => s.replace("expect(b)", "expect(c).to.equal(3); expect(b)")));
  assert.strictEqual(r.code, 0, r.out);
});
test("clean: no staged changes passes", () => {
  const r = staged(() => {});
  assert.strictEqual(r.code, 0, r.out);
});

// 1. Frozen spec.
test("frozen: any edit without approval fails", () => {
  const r = staged((d) => edit(d, "tests/characterization.ts", (s) => s.replace("sleep(1000)", "confirmAirdrop()")));
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /frozen v1 spec changed/);
});
test("frozen: timing-only edit with approval trailer passes with a warning", () => {
  const r = committed(
    (d) => edit(d, "tests/characterization.ts", (s) => s.replace("sleep(1000)", "confirmAirdrop()")),
    "test: confirmed airdrop wait\n\nFrozen-Change-Approved-By: Walter"
  );
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /WARN .*approved by: Walter/);
});
test("frozen: losing assertions is blocked even with approval", () => {
  const r = committed(
    (d) => edit(d, "tests/characterization.ts", (s) => s.replace("assert.ok(y);", "")),
    "test: simplify\n\nFrozen-Change-Approved-By: Walter\nTest-Guard-Override: trying"
  );
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /BLOCK .*lost assertions/);
});
test("frozen: deleting the spec is blocked", () => {
  const r = staged((d) => fs.rmSync(path.join(d, "tests/characterization.ts")), { RELICPAY_FROZEN_APPROVED: "1" });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /BLOCK/);
});

// 2. Deleted test file.
test("deleted test file fails", () => {
  const r = staged((d) => fs.rmSync(path.join(d, "tests/v2-features.ts")));
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /test file deleted/);
});

// 3. Assertions removed.
test("assertion removed from a kept test fails", () => {
  const r = staged((d) => edit(d, "tests/v2-features.ts", (s) => s.replace(" expect(b).to.equal(2);", "")));
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /assertions removed \(2 -> 1\)/);
});
test("commenting out an assertion counts as removing it", () => {
  const r = staged((d) => edit(d, "tests/v2-features.ts", (s) => s.replace(" expect(b).to.equal(2);", " // expect(b).to.equal(2);")));
  assert.strictEqual(r.code, 1, r.out);
});

// 4. Skips and silenced checkers.
for (const [label, mutate] of [
  [".skip", (s) => s.replace('it("c"', 'it.skip("c"')],
  [".only", (s) => s.replace('describe("v2"', 'describe.only("v2"')],
  ["xit", (s) => s.replace('it("c"', 'xit("c"')],
  ["@ts-ignore", (s) => "// @ts-ignore\n" + s],
  ["eslint-disable", (s) => "/* eslint-disable */\n" + s],
]) {
  test(`skip/silence: ${label} fails`, () => {
    const r = staged((d) => edit(d, "tests/v2-features.ts", mutate));
    assert.strictEqual(r.code, 1, r.out);
  });
}
test("rust: #[ignore] on a test fails", () => {
  const r = staged((d) => write(d, "programs/relicpay/src/math.rs", "#[cfg(test)]\nmod t {\n    #[test]\n    #[ignore]\n    fn f() { assert_eq!(1, 1); }\n}\n"));
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /#\[ignore\]/);
});
test("rust: #[allow(...)] in program code fails", () => {
  const r = staged((d) => edit(d, "programs/relicpay/src/instructions/repay.rs", (s) => "#[allow(unused)]\n" + s));
  assert.strictEqual(r.code, 1, r.out);
});

// 5. Unfinished code.
test("unfinished: todo!() fails", () => {
  const r = staged((d) => edit(d, "programs/relicpay/src/instructions/repay.rs", (s) => s.replace("Ok(())", "todo!()")));
  assert.strictEqual(r.code, 1, r.out);
});
test("unfinished: empty catch fails", () => {
  const r = staged((d) => edit(d, "app/lib/client.ts", (s) => s.replace("catch (e) { throw e; }", "catch (e) {}")));
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /empty catch/);
});

// Program checks removed: warning only.
test("program: removing a require! warns but does not fail", () => {
  const r = staged((d) => edit(d, "programs/relicpay/src/instructions/repay.rs", (s) => s.replace(/    require_keys_eq!.*\n/, "")));
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /WARN .*program checks decreased \(require!\/constraint\/has_one 2 -> 1\)/);
});

// 6. Guard changes.
test("guard: adding the guard files is allowed", () => {
  const r = staged((d) => write(d, "scripts/test-guard.js", "// guard\n"));
  assert.strictEqual(r.code, 0, r.out);
});
test("guard: editing the guard needs an override", () => {
  const dir = makeRepo();
  write(dir, "scripts/test-guard.js", "// guard v1\n");
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "add guard"]);
  write(dir, "scripts/test-guard.js", "// guard v2, weaker\n");
  sh(dir, "git", ["add", "-A"]);
  assert.strictEqual(guard(dir).code, 1);
  assert.strictEqual(guard(dir, [], { RELICPAY_TEST_GUARD_OVERRIDE: "Walter approved new rule" }).code, 0);
});

// Overrides.
test("override: Test-Guard-Override trailer passes non-frozen findings and prints them", () => {
  const r = committed((d) => fs.rmSync(path.join(d, "tests/v2-features.ts")), "test: retire v2 file\n\nTest-Guard-Override: merged into agent-mandate.ts");
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /OVERRIDDEN .*test file deleted/);
});

// Usage errors.
test("usage: unknown flag exits 2", () => {
  const r = guard(makeRepo(), ["--nope"]);
  assert.strictEqual(r.code, 2, r.out);
});

let failed = 0;
for (const c of cases) {
  try {
    c.fn();
    console.log(`  ok   ${c.name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${c.name}\n${String(err.message).split("\n").map((l) => "       " + l).join("\n")}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
