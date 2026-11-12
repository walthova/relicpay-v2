// The wire encoding for messages crossing chrome.runtime. Part c2a of the browser extension revival.
//
// chrome.runtime.sendMessage serializes with JSON, which throws on BigInt. Every amount in a quote
// and every uint in a signed AgreementRequest is a BigInt (ADR-003, ADR-004), so a message built by
// extension/lib/messages.js cannot cross a context boundary as is. toWire tags each BigInt as
// { "$bigint": "<decimal>" } and fromWire reverses it. The tag is only honoured on the exact shape
// { $bigint: string of digits } so a page-controlled string that merely looks like one is data.
//
// Framework free and chrome free.

class WireError extends Error {}

const TAG = '$bigint';
const DIGITS = /^-?\d+$/;

function toWire(value) {
  if (typeof value === 'bigint') return { [TAG]: value.toString() };
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === TAG) throw new WireError(`a field named ${TAG} would be read back as a BigInt`);
      out[k] = toWire(v);
    }
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new WireError('functions and symbols cannot cross the wire');
  }
  return value;
}

function fromWire(value) {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === TAG) {
      if (typeof value[TAG] !== 'string' || !DIGITS.test(value[TAG])) {
        throw new WireError('malformed BigInt tag');
      }
      return BigInt(value[TAG]);
    }
    if (keys.includes(TAG)) throw new WireError('malformed BigInt tag');
    const out = {};
    for (const k of keys) out[k] = fromWire(value[k]);
    return out;
  }
  return value;
}

module.exports = { WireError, toWire, fromWire };
