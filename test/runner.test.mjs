import assert from 'node:assert/strict';
import test from 'node:test';
import { canSettleFailureAtZero, evidenceExcerpt } from '../src/runner.mjs';

test('only a proven pre-start failure may release the reservation to zero', () => {
  assert.equal(canSettleFailureAtZero(false), true);
  assert.equal(canSettleFailureAtZero(true), false);
});

test('public evidence is field-allowlisted and bounded', () => {
  const excerpt = evidenceExcerpt([{ text: 'x'.repeat(5000), secretExtra: 'do not publish', success: true }], { textPaths: ['text'], successPaths: ['success'], errorPaths: ['error'] });
  assert.equal('secretExtra' in excerpt[0], false);
  assert.ok(excerpt[0].text.length < 4100);
  assert.equal(excerpt[0].success, true);
});
