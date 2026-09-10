const test = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../public/quality-utils.js');

test('a constrained receiver reduces its own budget while a fast receiver improves', () => {
  const slow = quality.nextBudget(2_500_000, { estimate: 800_000, bandwidth: true }, 8_000_000);
  const fast = quality.nextBudget(5_000_000, { estimate: 12_000_000 }, 8_000_000);
  assert.ok(slow < 2_500_000);
  assert.ok(fast > 5_000_000);
  assert.deepEqual(quality.allocate([slow, fast], 34_000_000), [slow, fast]);
});
test('total allocation respects upload limit without a per-stream floor overriding it', () => {
  const shares = quality.allocate(Array(20).fill(8_000_000), 8_500_000);
  assert.ok(shares.reduce((a, b) => a + b, 0) <= 8_500_000);
  assert.equal(shares[0], 425_000);
});
test('adaptation recovers, honors profile caps, and avoids probing up on CPU limitation', () => {
  assert.equal(quality.nextBudget(2_000_000, { cpu: true, estimate: 8_000_000 }, 8_000_000), 2_000_000);
  let budget = 500_000;
  for (let i = 0; i < 25; i++) budget = quality.nextBudget(budget, { estimate: 20_000_000 }, 14_000_000);
  assert.equal(budget, 14_000_000);
  assert.equal(quality.nextBudget(budget, { estimate: 20_000_000 }, 4_000_000), 4_000_000);
});
test('resolution changes resist small bandwidth oscillations and recover to HD', () => {
  assert.equal(quality.resolutionLimit(3_100_000, 1280), 1280);
  assert.equal(quality.resolutionLimit(3_600_000, 1280), 1920);
  assert.equal(quality.resolutionLimit(2_900_000, 1920), 1920);
  assert.equal(quality.resolutionLimit(2_000_000, 1920), 1280);
  assert.equal(quality.resolutionLimit(7_000_000, 1920), 2560);
});
