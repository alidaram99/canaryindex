import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { submitIndexNow } from '../src/indexnow.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('IndexNow submits only the three weekly-changing canonical resources with scoped keyLocation', async () => {
  let request;
  const result = await submitIndexNow({
    configFile: path.join(root, 'config', 'canaries.json'),
    publicRepoDir: root,
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return { status: 200, text: async () => '' };
    },
  });
  assert.equal(request.url, 'https://api.indexnow.org/indexnow');
  assert.deepEqual(request.body.urlList, [
    'https://alidaram99.github.io/canaryindex/',
    'https://alidaram99.github.io/canaryindex/data/latest.json',
    'https://alidaram99.github.io/canaryindex/api/recommendations.json',
  ]);
  assert.equal(request.body.keyLocation, 'https://alidaram99.github.io/canaryindex/8459e4b1d8cc4f46a7c96b963074d82a.txt');
  assert.equal(result.submitted, 3);
});
