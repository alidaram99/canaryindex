import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendations, summarizeTools } from '../src/history.mjs';
import { selectRecommendation } from '../src/recommend.mjs';

const config = {
  budgetBucketsUsdPerUnit: [0.01],
  categories: [{ id: 'doc', title: 'Doc', unit: 'page', qualityThreshold: 0.8 }],
  tools: [
    { key: 'ours', category: 'doc', actorId: 'us~a', displayName: 'Ours', storeUrl: '#', ownedByPublisher: true },
    { key: 'cheap', category: 'doc', actorId: 'x~a', displayName: 'Cheap', storeUrl: '#', ownedByPublisher: false },
    { key: 'quality', category: 'doc', actorId: 'y~a', displayName: 'Quality', storeUrl: '#', ownedByPublisher: false },
  ],
};

const runs = [{ startedAt: '2026-10-01', finishedAt: '2026-10-01', results: [
  { toolKey: 'ours', runStatus: 'SUCCEEDED', publicListing: false, accepted: true, quality: 1, units: 1, latencyMs: 10, cost: { costKnown: true, comparativeCostUsd: 0.001, comparativeCostPerUnitUsd: 0.001 } },
  { toolKey: 'cheap', runStatus: 'SUCCEEDED', publicListing: true, accepted: true, quality: 0.8, units: 1, latencyMs: 20, cost: { costKnown: true, comparativeCostUsd: 0.003, comparativeCostPerUnitUsd: 0.003 } },
  { toolKey: 'quality', runStatus: 'SUCCEEDED', publicListing: true, accepted: true, quality: 1, units: 1, latencyMs: 30, cost: { costKnown: true, comparativeCostUsd: 0.008, comparativeCostPerUnitUsd: 0.008 } },
]}];

test('private own tool is disclosed but excluded from recommendation', () => {
  const summaries = summarizeTools(config, runs);
  const recs = recommendations(config, summaries);
  assert.deepEqual(recs.doc.bestQuality, ['quality', 'cheap']);
  assert.equal(selectRecommendation(recs.doc, { maxCostUsdPerUnit: 0.005 }).toolKey, 'cheap');
  assert.equal(selectRecommendation(recs.doc, { maxCostUsdPerUnit: 0.01, strategy: 'best-quality' }).toolKey, 'quality');
});

test('unknown comparative cost is never treated as zero or routed under a budget', () => {
  const unknownRuns = [{ startedAt: '2026-10-02', finishedAt: '2026-10-02', results: [
    { toolKey: 'cheap', runStatus: 'SUCCEEDED', publicListing: true, accepted: true, quality: 1, units: 1, latencyMs: 5, cost: { costKnown: false, comparativeCostUsd: null } },
  ] }];
  const summaries = summarizeTools(config, unknownRuns);
  const cheap = summaries.find((item) => item.toolKey === 'cheap');
  assert.equal(cheap.effectiveCostPerAcceptedUnitUsd, null);
  assert.deepEqual(recommendations(config, summaries).doc.budgetsUsdPerUnit['0.01'], []);
});

test('monitoring infrastructure failure is visible but does not reduce tool reliability', () => {
  const mixedRuns = [runs[0], { startedAt: '2026-10-03', finishedAt: '2026-10-03', results: [
    { toolKey: 'cheap', runStatus: 'FAILED_TO_OBSERVE', publicListing: true, accepted: false, quality: 0, units: 1, latencyMs: null, cost: { costKnown: false, comparativeCostUsd: null } },
  ] }];
  const cheap = summarizeTools(config, mixedRuns).find((item) => item.toolKey === 'cheap');
  assert.equal(cheap.reliability, 1);
  assert.equal(cheap.observationFailures, 1);
  assert.equal(cheap.latestAccepted, false);
});
