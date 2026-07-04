#!/usr/bin/env node
// Test runner — registers ts-node in the same process before mocha runs.
// This bypasses the ESM/CJS conflict in mocha 10.x + anchor 0.32.

require("ts-node").register({
  project: require("path").join(__dirname, "..", "tsconfig.json"),
  transpileOnly: true,
});

const Mocha = require("mocha");
const path = require("path");
const fs = require("fs");

const mocha = new Mocha({ timeout: 60000 });

const testDir = path.join(__dirname, "..", "tests");
fs.readdirSync(testDir)
  .filter((f) => f.endsWith(".ts"))
  .forEach((f) => mocha.addFile(path.join(testDir, f)));

mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
