const assert = require('assert');
const { E, IMPL } = require('./helpers');
const { runDemo, setupLocal } = require('../tools/demo');

// The demo script (tools/demo.js) is v2-only: it deploys straight from build/v2 and narrates
// the MVP flow the roadmap asked for. Legacy has no RelicRegistry to tokenize against.
(IMPL === 'v2' ? describe : describe.skip)('Demo script [v2]', function () {
  this.timeout(120000);

  it('walks mint -> collateral -> agreement -> payments -> ownership transfer end to end', async () => {
    const ctx = await setupLocal();
    const results = await runDemo(ctx);

    assert.equal(results.creditLimit, E('8')); // 80% of 10 ETH collateral
    assert.equal(results.finalState, 1n); // BnplState.Completed
    assert.equal(results.relicOwner, ctx.buyer.address);
    assert.equal(results.sellerBalance, E('6'));
  });
});
