// Public surface of the dashboard data layer.
//
// Part a of the "Next.js buyer/seller dashboard" roadmap item. Everything here is framework free
// and runs identically in Node (the characterization suite) and in the browser (part b's Next.js
// app). Nothing in this directory may import React, next/* or wagmi: the point of the split is that
// the data layer is provable against a real chain without a renderer.

const abis = require('./abis');
const addresses = require('./addresses');
const client = require('./client');
const enums = require('./enums');
const panels = require('./panels');
const present = require('./present');
const reader = require('./reader');
const tokens = require('./tokens');
const writes = require('./writes');

module.exports = {
  ...abis,
  ...addresses,
  ...client,
  ...enums,
  ...panels,
  ...present,
  ...reader,
  ...tokens,
  ...writes,
  abis,
};
