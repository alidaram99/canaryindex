#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runWeekly } from '../src/runner.mjs';
import { buildSite } from '../src/site.mjs';
import { readJson } from '../src/util.mjs';
import { selectRecommendation } from '../src/recommend.mjs';
import { submitIndexNow } from '../src/indexnow.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function args(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) result._.push(value);
    else {
      const key = value.slice(2);
      const next = argv[index + 1];
      result[key] = next && !next.startsWith('--') ? argv[++index] : true;
    }
  }
  return result;
}

function usage() {
  console.log(`CanaryIndex — live scorecards for AI-agent tools

Commands:
  live --public-repo DIR [--run-key KEY]   Run budgeted live canaries and checkpoint evidence
  build --public-repo DIR                  Build docs/, JSON APIs, llms.txt and raw downloads
  indexnow --public-repo DIR               Submit generated sitemap URLs to IndexNow
  recommend --json FILE --category ID --max-cost USD [--strategy best-quality]

Environment for live: APIFY_TOKEN. Never put the token in a URL or file.`);
}

const parsed = args(process.argv.slice(2));
const command = parsed._[0];
const configFile = path.resolve(parsed.config || path.join(root, 'config', 'canaries.json'));

try {
  if (command === 'live') {
    if (!parsed['public-repo']) throw new Error('--public-repo is required.');
    const record = await runWeekly({
      configFile,
      publicRepoDir: path.resolve(parsed['public-repo']),
      token: process.env.APIFY_TOKEN,
      runKey: parsed['run-key'] || `manual-${process.env.GITHUB_RUN_ID || Date.now()}`,
    });
    console.log(JSON.stringify({ runKey: record.runKey, results: record.results.length, budget: record.budget }, null, 2));
  } else if (command === 'build') {
    if (!parsed['public-repo']) throw new Error('--public-repo is required.');
    const built = await buildSite({ configFile, publicRepoDir: path.resolve(parsed['public-repo']) });
    console.log(JSON.stringify({ runs: built.runs.length, tools: built.summaries.length, docsDir: built.docsDir }, null, 2));
  } else if (command === 'recommend') {
    if (!parsed.json || !parsed.category) throw new Error('--json and --category are required.');
    const data = await readJson(path.resolve(parsed.json));
    const category = data.categories?.[parsed.category];
    const selected = selectRecommendation(category, {
      maxCostUsdPerUnit: parsed['max-cost'] === undefined ? Infinity : Number(parsed['max-cost']),
      strategy: parsed.strategy || 'lowest-cost-accepted',
    });
    console.log(JSON.stringify({ category: parsed.category, maxCostUsdPerUnit: parsed['max-cost'] ?? null, recommendation: selected }, null, 2));
    if (!selected) process.exitCode = 2;
  } else if (command === 'indexnow') {
    if (!parsed['public-repo']) throw new Error('--public-repo is required.');
    console.log(JSON.stringify(await submitIndexNow({ configFile, publicRepoDir: path.resolve(parsed['public-repo']) }), null, 2));
  } else {
    usage();
    if (command) process.exitCode = 2;
  }
} catch (error) {
  console.error(`CanaryIndex: ${error.message}`);
  process.exitCode = 1;
}
