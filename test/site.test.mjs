import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../src/site.mjs';
import { writeJson } from '../src/util.mjs';

const productRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('site build emits scorecards, agent JSON, raw data and discovery files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'canaryindex-site-'));
  try {
    await writeJson(path.join(dir, 'data', 'history', 'sample.json'), {
      schemaVersion: 1,
      startedAt: '2026-10-03T00:00:00Z',
      finishedAt: '2026-10-03T00:01:00Z',
      results: [{ toolKey: 'memo23-pdf-text-extractor', runStatus: 'SUCCEEDED', publicListing: true, accepted: true, quality: 1, units: 1, latencyMs: 1000, reason: 'ok', cost: { comparativeCostUsd: 0.01, comparativeCostPerUnitUsd: 0.01 } }],
    });
    await buildSite({ configFile: path.join(productRoot, 'config', 'canaries.json'), publicRepoDir: dir });
    for (const file of ['docs/index.html', 'docs/method/index.html', 'docs/api/recommendations.json', 'docs/data/latest.json', 'docs/llms.txt', 'docs/robots.txt', 'docs/sitemap.xml']) await access(path.join(dir, file));
    const home = await readFile(path.join(dir, 'docs', 'index.html'), 'utf8');
    assert.match(home, /CanaryIndex/);
    assert.match(home, /Publisher-owned tool/);
    const api = JSON.parse(await readFile(path.join(dir, 'docs', 'api', 'recommendations.json'), 'utf8'));
    assert.equal(api.neutralRanking, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
