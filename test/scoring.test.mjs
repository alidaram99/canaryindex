import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRunCost, evaluateOutput, tokenRecall, validateOutputContract, wordErrorRate } from '../src/scoring.mjs';

test('document recall is exact and case-insensitive', () => {
  assert.deepEqual(tokenRecall('## Dummy PDF file', ['dummy', 'pdf', 'file']), { score: 1, found: ['dummy', 'pdf', 'file'], missing: [] });
});

test('word error rate treats punctuation and apostrophes consistently', () => {
  const result = wordErrorRate("That's one small step for man", 'Thats one small step for a man');
  assert.equal(result.distance, 1);
  assert.equal(result.expectedWords, 7);
});

test('audio scorer takes the fairest published reference, not a hidden reference', () => {
  const category = { id: 'audio-to-text', qualityThreshold: 0.7, fixture: { expectedText: 'bad reference', expectedTexts: ['bad reference', 'one small step for man'] } };
  const tool = { textPaths: ['text'] };
  const result = evaluateOutput(category, tool, [{ text: 'One small step for man.' }]);
  assert.equal(result.accepted, true);
  assert.equal(result.quality, 1);
  assert.equal(result.evidence.publishedReferenceCount, 2);
});

test('an explicit tool error or false success flag cannot pass on text alone', () => {
  const tool = { textPaths: ['text'], successPaths: ['success'], errorPaths: ['error'] };
  assert.equal(validateOutputContract([{ text: 'Dummy PDF file', error: 'conversion failed' }], tool).accepted, false);
  assert.equal(validateOutputContract([{ text: 'Dummy PDF file', success: false }], tool).accepted, false);
  assert.equal(validateOutputContract([{ text: 'Dummy PDF file', success: true }], tool).accepted, true);
});

test('charged events and buyer-paid usage produce transparent total cost', () => {
  const result = calculateRunCost({
    run: { chargedEventCounts: { page: 2 }, usageTotalUsd: 0.001 },
    pricingInfo: { pricingModel: 'PAY_PER_EVENT', isPPEPlatformUsagePaidByUser: true, pricingPerEvent: { actorChargeEvents: { page: { eventPriceUsd: 0.003 } } } },
    units: 2,
  });
  assert.equal(result.eventCostUsd, 0.006);
  assert.equal(result.totalCostUsd, 0.007);
  assert.equal(result.costPerUnitUsd, 0.0035);
});

test('unknown charged-event price is never called free', () => {
  const result = calculateRunCost({ run: { chargedEventCounts: { mystery: 1 }, usageTotalUsd: 0 }, pricingInfo: { pricingModel: 'PAY_PER_EVENT' }, units: 1 });
  assert.equal(result.costKnown, false);
  assert.equal(result.totalCostUsd, null);
});
