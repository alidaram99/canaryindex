import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { calculateRunCost, evaluateOutput } from './scoring.mjs';
import { finalizeReservation, readLedger, reserve, summarizeBudget } from './budget.mjs';
import { abortRun, getActor, getDatasetItems, getStoreItem, pollRun, settleRun, startRun } from './apify.mjs';
import { assertSafePublicResult, deepReplace, getPath, isoWeekKey, listJsonFiles, readJson, round, sha256, utcMonth, writeJson } from './util.mjs';

const execFileAsync = promisify(execFile);

export async function gitCheckpoint(repoDir, message) {
  await execFileAsync('git', ['-C', repoDir, 'add', 'data']);
  try {
    await execFileAsync('git', ['-C', repoDir, 'commit', '-m', message]);
  } catch (error) {
    const combined = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (!/nothing to commit|no changes added/i.test(combined)) throw error;
  }
  await execFileAsync('git', ['-C', repoDir, 'push', 'origin', 'HEAD:main']);
}

export function canSettleFailureAtZero(startAttempted, error = null) {
  if (startAttempted === false) return true;
  return [400, 401, 402, 403, 404, 409, 422, 429].includes(error?.apifyStatus);
}

function currentPricingInfo(actor) {
  return Array.isArray(actor?.pricingInfos) ? actor.pricingInfos.at(-1) ?? null : null;
}

function boundedValue(value, maxLength = 4000) {
  if (typeof value === 'string') return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => boundedValue(item, Math.min(maxLength, 1000)));
  return String(value).slice(0, maxLength);
}

export function evidenceExcerpt(items, tool) {
  const paths = [...new Set([...(tool.textPaths ?? []), ...(tool.successPaths ?? []), ...(tool.errorPaths ?? [])])];
  return items.slice(0, 5).map((item) => Object.fromEntries(paths.flatMap((dotted) => {
    const value = getPath(item, dotted);
    return value === undefined ? [] : [[dotted, boundedValue(value)]];
  })));
}

async function findExistingRun(historyDir, runKey) {
  for (const file of await listJsonFiles(historyDir)) {
    const record = await readJson(file);
    if (record?.schemaVersion === 1 && record.runKey === runKey && Array.isArray(record.results)) return { file, record };
  }
  return null;
}

function categoryFor(config, tool) {
  const category = config.categories.find((item) => item.id === tool.category);
  if (!category) throw new Error(`Missing category ${tool.category} for ${tool.key}`);
  return category;
}

function adjustedComparativeCounts(run, tool, units) {
  const counts = { ...(run.chargedEventCounts ?? {}) };
  if (!tool.ownedByPublisher) return counts;
  const customEvents = Object.keys(tool.fallbackEventPrices).filter((name) => name !== 'apify-actor-start');
  if (customEvents.length === 1 && (counts[customEvents[0]] ?? 0) === 0) counts[customEvents[0]] = units;
  return counts;
}

function sanitizeStoreStats(item) {
  if (!item) return null;
  return {
    totalUsers: item.stats?.totalUsers ?? null,
    totalUsers30Days: item.stats?.totalUsers30Days ?? null,
    totalRuns30Days: item.stats?.totalRuns30Days ?? null,
    rating: item.actorReviewRating ?? item.stats?.actorReviewRating ?? null,
    reviewCount: item.actorReviewCount ?? item.stats?.actorReviewCount ?? null,
    observedTitle: item.title ?? null,
  };
}

function runSnapshot(run) {
  return {
    id: run.id,
    status: run.status,
    buildId: run.buildId ?? null,
    buildNumber: run.buildNumber ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    usageTotalUsd: Number.isFinite(run.usageTotalUsd) ? run.usageTotalUsd : null,
    chargedEventCounts: run.chargedEventCounts ?? {},
    stats: {
      runTimeSecs: run.stats?.runTimeSecs ?? null,
      computeUnits: run.stats?.computeUnits ?? null,
    },
  };
}

function errorResult(tool, category, reason, runId = null, { storeItem = null, httpStatus = null } = {}) {
  return {
    schemaVersion: 1,
    toolKey: tool.key,
    category: category.id,
    actorId: tool.actorId,
    displayName: tool.displayName,
    storeUrl: tool.storeUrl,
    ownedByPublisher: tool.ownedByPublisher,
    publicListing: Boolean(storeItem),
    runId,
    runStatus: 'FAILED_TO_OBSERVE',
    accepted: false,
    quality: 0,
    reason,
    httpStatus,
    units: category.fixture.units,
    latencyMs: null,
    cost: {
      observedAccountSpendUsd: null,
      comparativeCostUsd: null,
      comparativeCostPerUnitUsd: null,
      costKnown: false,
      note: 'No stable billing observation was available; the full reservation remains in the budget ledger.'
    },
    storeStats: sanitizeStoreStats(storeItem),
    output: { itemCount: 0, items: [] },
    run: null,
  };
}

function historicalDefiniteNoRun(result) {
  if (result?.runId != null) return false;
  const match = String(result?.reason ?? '').match(/Apify POST .* returned (\d{3}):/);
  const status = result?.httpStatus ?? Number(match?.[1]);
  return [400, 401, 402, 403, 404, 409, 422, 429].includes(status);
}

async function reconcileHistoricalRejectedStarts(ledgerDir, historyDir) {
  const histories = [];
  for (const file of await listJsonFiles(historyDir)) histories.push(await readJson(file));
  for (const record of await readLedger(ledgerDir)) {
    if (record.status === 'completed') continue;
    const run = histories.find((item) => item.runKey === record.runKey);
    const result = run?.results?.find((item) => item.toolKey === record.toolKey);
    if (!historicalDefiniteNoRun(result)) continue;
    await finalizeReservation(record, {
      actualCostUsd: 0,
      apifyRunId: null,
      status: 'settled',
      note: `Reconciled to $0 because Apify returned HTTP ${result.httpStatus ?? '4xx'} before creating a run; the published observation has no run ID.`,
    });
  }
}

export async function runWeekly({ configFile, publicRepoDir, token, runKey = `manual-${isoWeekKey()}`, checkpoint = gitCheckpoint, now = new Date() }) {
  if (!token) throw new Error('APIFY_TOKEN is required for a live canary run.');
  const config = await readJson(configFile);
  const ledgerDir = path.join(publicRepoDir, 'data', 'ledger');
  const historyDir = path.join(publicRepoDir, 'data', 'history');
  await reconcileHistoricalRejectedStarts(ledgerDir, historyDir);
  const prior = await findExistingRun(historyDir, runKey);
  const runFile = prior?.file ?? path.join(historyDir, `${now.toISOString().replace(/[:.]/g, '-')}-${runKey.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`);
  const runRecord = prior?.record ?? {
    schemaVersion: 1,
    brand: config.brand,
    methodVersion: config.methodVersion,
    runKey,
    startedAt: now.toISOString(),
    finishedAt: null,
    configSha256: sha256(config),
    neutrality: 'Publisher-owned tools are disclosed. Payment, sponsorship and ownership never affect scoring or ranking.',
    budget: null,
    results: [],
  };

  for (const tool of config.tools) {
    const category = categoryFor(config, tool);
    const currentRecords = await readLedger(ledgerDir);
    const duplicate = currentRecords.find((record) => record.runKey === runKey && record.toolKey === tool.key && record.fixtureId === category.fixture.id);
    if (duplicate && runRecord.results.some((result) => result.toolKey === tool.key)) continue;
    if (duplicate) {
      runRecord.results.push(errorResult(tool, category, 'A prior budget reservation exists without a recoverable observation. The reservation remains fail-closed; this tool will be observed under the next run key.', duplicate.apifyRunId ?? null));
      await writeJson(runFile, runRecord);
      await checkpoint(publicRepoDir, `canary: preserve incomplete ${tool.key} (${runKey})`);
      continue;
    }
    const reservation = await reserve({
      ledgerDir,
      runKey,
      tool,
      fixture: category.fixture,
      reservedUsd: tool.maxChargeUsd ?? config.perRunMaxChargeUsd,
      monthlyCapUsd: config.monthlyBudgetUsd,
      now,
    });
    await checkpoint(publicRepoDir, `budget: reserve ${tool.key} (${runKey})`);

    let runId = null;
    let result;
    let ledgerActual = null;
    let ledgerStatus = 'unknown';
    let startAttempted = false;
    let storeItem = null;
    const started = Date.now();
    try {
      storeItem = await getStoreItem(tool.actorId);
      const actor = await getActor(token, tool.actorId);
      const pricingInfo = storeItem?.currentPricingInfo ?? currentPricingInfo(actor);
      if (pricingInfo?.pricingModel !== 'PAY_PER_EVENT') {
        throw new Error(`CanaryIndex only runs PAY_PER_EVENT Actors because Apify's maxTotalChargeUsd guard does not cap ${pricingInfo?.pricingModel ?? 'unknown'} pricing.`);
      }
      const input = deepReplace(tool.input, '$FIXTURE_URL', category.fixture.url);
      startAttempted = true;
      const initial = await startRun(token, tool.actorId, input, tool.maxChargeUsd ?? config.perRunMaxChargeUsd);
      runId = initial.id;
      const terminal = await pollRun(token, runId, { timeoutMs: config.runTimeoutMs });
      const settled = await settleRun(token, runId);
      const finalRun = settled.run ?? terminal;
      const items = finalRun.defaultDatasetId ? await getDatasetItems(token, finalRun.defaultDatasetId) : [];
      const evaluated = finalRun.status === 'SUCCEEDED'
        ? evaluateOutput(category, tool, items)
        : { accepted: false, quality: 0, extractedText: '', reason: `Actor run ended with ${finalRun.status}.` };
      const observedPricingInfo = finalRun.pricingInfo ?? pricingInfo ?? null;
      const comparativeRun = { ...finalRun, chargedEventCounts: adjustedComparativeCounts(finalRun, tool, category.fixture.units) };
      const comparative = calculateRunCost({ run: comparativeRun, pricingInfo: observedPricingInfo, fallbackEventPrices: tool.fallbackEventPrices, units: category.fixture.units });
      const observed = calculateRunCost({ run: finalRun, pricingInfo: observedPricingInfo, fallbackEventPrices: tool.fallbackEventPrices, units: category.fixture.units });
      ledgerActual = tool.ownedByPublisher
        ? (Number.isFinite(finalRun.usageTotalUsd) ? finalRun.usageTotalUsd : null)
        : observed.totalCostUsd;
      ledgerStatus = settled.stable && Number.isFinite(ledgerActual) ? 'settled' : 'unknown';
      result = {
        schemaVersion: 1,
        toolKey: tool.key,
        category: category.id,
        actorId: tool.actorId,
        displayName: tool.displayName,
        storeUrl: tool.storeUrl,
        ownedByPublisher: tool.ownedByPublisher,
        publicListing: Boolean(storeItem),
        runId,
        runStatus: finalRun.status,
        accepted: finalRun.status === 'SUCCEEDED' && evaluated.accepted,
        quality: evaluated.quality,
        reason: evaluated.reason,
        evidence: evaluated.evidence ?? null,
        units: category.fixture.units,
        latencyMs: Number.isFinite(finalRun.stats?.runTimeSecs) ? round(finalRun.stats.runTimeSecs * 1000, 2) : Date.now() - started,
        cost: {
          observedAccountSpendUsd: round(ledgerActual),
          comparativeCostUsd: comparative.totalCostUsd,
          comparativeCostPerUnitUsd: comparative.costPerUnitUsd,
          costKnown: comparative.costKnown,
          priceTier: 'FREE',
          chargedEvents: comparative.chargedEvents,
          usageTotalUsd: comparative.usageTotalUsd,
          note: tool.ownedByPublisher
            ? 'The publisher is exempt from its own custom Actor events. Comparative cost simulates the public event count from delivered fixture units; the raw self-run counts and actual account usage remain published separately.'
            : 'Comparative cost is calculated from this authenticated run’s charged event counts and the FREE-tier list price in the run/Store snapshot; buyer-paid platform usage is included when applicable.',
        },
        storeStats: sanitizeStoreStats(storeItem),
        output: { itemCount: items.length, extractedText: evaluated.extractedText, rawSha256: sha256(items), items: evidenceExcerpt(items, tool) },
        run: runSnapshot(finalRun),
      };
    } catch (error) {
      if (runId && error.code === 'CANARY_RUN_TIMEOUT') {
        try {
          await abortRun(token, runId);
        } catch (abortError) {
          error.message = `${error.message} Abort also failed: ${abortError.message}`;
        }
      }
      if (!runId && canSettleFailureAtZero(startAttempted, error)) {
        ledgerActual = 0;
        ledgerStatus = 'settled';
      }
      result = errorResult(tool, category, error.message, runId, { storeItem, httpStatus: error.apifyStatus ?? null });
    }
    assertSafePublicResult(result);
    runRecord.results.push(result);
    await finalizeReservation(reservation.record, { actualCostUsd: ledgerActual, apifyRunId: runId, status: ledgerStatus });
    runRecord.budget = summarizeBudget(await readLedger(ledgerDir), config.monthlyBudgetUsd, utcMonth(now));
    await writeJson(runFile, runRecord);
    await checkpoint(publicRepoDir, `canary: record ${tool.key} (${runKey})`);
  }

  runRecord.finishedAt = new Date().toISOString();
  runRecord.budget = summarizeBudget(await readLedger(ledgerDir), config.monthlyBudgetUsd, utcMonth(now));
  await writeJson(runFile, runRecord);
  await checkpoint(publicRepoDir, `canary: finish ${runKey}`);
  return runRecord;
}
