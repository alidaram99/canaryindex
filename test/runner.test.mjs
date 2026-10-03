import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustedComparativeCounts, canSettleFailureAtZero, evidenceExcerpt } from '../src/runner.mjs';

test('only a proven pre-start failure may release the reservation to zero', () => {
  assert.equal(canSettleFailureAtZero(false), true);
  assert.equal(canSettleFailureAtZero(true), false);
  assert.equal(canSettleFailureAtZero(true, { apifyStatus: 403 }), true);
  assert.equal(canSettleFailureAtZero(true, { apifyStatus: 500 }), false);
});

test('public evidence is field-allowlisted and bounded', () => {
  const excerpt = evidenceExcerpt([{ text: 'x'.repeat(5000), secretExtra: 'do not publish', success: true }], { textPaths: ['text'], successPaths: ['success'], errorPaths: ['error'] });
  assert.equal('secretExtra' in excerpt[0], false);
  assert.ok(excerpt[0].text.length < 4100);
  assert.equal(excerpt[0].success, true);
});

test('owner-exempt custom events are marked as simulated, not observed charges', () => {
  const own = adjustedComparativeCounts(
    { chargedEventCounts: { 'apify-actor-start': 1 } },
    { ownedByPublisher: true, fallbackEventPrices: { 'apify-actor-start': 0.0005, 'page-converted': 0.0045 } },
    1,
  );
  assert.equal(own.isSimulated, true);
  assert.equal(own.counts['page-converted'], 1);

  const thirdParty = adjustedComparativeCounts(
    { chargedEventCounts: { result: 1 } },
    { ownedByPublisher: false, fallbackEventPrices: { result: 0.01 } },
    1,
  );
  assert.equal(thirdParty.isSimulated, false);
  assert.deepEqual(thirdParty.counts, { result: 1 });
});
