import { listJsonFiles, readJson, round } from './util.mjs';

export async function readHistory(historyDir) {
  const files = await listJsonFiles(historyDir);
  const runs = [];
  for (const file of files) {
    const value = await readJson(file);
    if (value?.schemaVersion === 1 && Array.isArray(value.results)) runs.push(value);
  }
  return runs.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeTools(config, runs) {
  const observations = runs.flatMap((run) => run.results.map((result) => ({ ...result, observedAt: run.finishedAt ?? run.startedAt })));
  return config.tools.map((tool) => {
    const list = observations.filter((item) => item.toolKey === tool.key).sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
    const latest = list.at(-1) ?? null;
    const completed = list.filter((item) => item.runStatus && !['NOT_RUN', 'FAILED_TO_OBSERVE'].includes(item.runStatus));
    const accepted = completed.filter((item) => item.accepted);
    const allCostsKnown = completed.length > 0 && completed.every((item) => item.cost?.costKnown === true && Number.isFinite(item.cost?.comparativeCostUsd));
    const totalComparativeCost = allCostsKnown
      ? completed.reduce((sum, item) => sum + item.cost.comparativeCostUsd, 0)
      : null;
    const acceptedUnits = accepted.reduce((sum, item) => sum + (Number(item.units) || 0), 0);
    return {
      toolKey: tool.key,
      category: tool.category,
      actorId: tool.actorId,
      displayName: tool.displayName,
      storeUrl: tool.storeUrl,
      ownedByPublisher: tool.ownedByPublisher,
      publicListing: latest?.publicListing ?? false,
      observations: completed.length,
      observationFailures: list.length - completed.length,
      acceptedRuns: accepted.length,
      reliability: completed.length ? round(accepted.length / completed.length, 4) : null,
      latestAccepted: latest?.accepted ?? false,
      latestQuality: latest?.quality ?? null,
      latestCostPerUnitUsd: latest?.cost?.comparativeCostPerUnitUsd ?? null,
      effectiveCostPerAcceptedUnitUsd: acceptedUnits && allCostsKnown ? round(totalComparativeCost / acceptedUnits) : null,
      medianLatencyMs: round(median(completed.map((item) => item.latencyMs)), 2),
      latestObservedAt: latest?.observedAt ?? null,
      latestRunStatus: latest?.runStatus ?? 'NOT_RUN',
      latestReason: latest?.reason ?? 'No observation yet.',
      stats: latest?.storeStats ?? null,
    };
  });
}

export function recommendations(config, summaries) {
  const categories = {};
  for (const category of config.categories) {
    const eligible = summaries.filter((item) => item.category === category.id && item.publicListing && item.latestAccepted);
    const byQuality = [...eligible].sort((a, b) =>
      (b.latestQuality ?? -1) - (a.latestQuality ?? -1)
      || (b.reliability ?? -1) - (a.reliability ?? -1)
      || (a.effectiveCostPerAcceptedUnitUsd ?? Infinity) - (b.effectiveCostPerAcceptedUnitUsd ?? Infinity)
      || (a.medianLatencyMs ?? Infinity) - (b.medianLatencyMs ?? Infinity));
    const budgets = Object.fromEntries(config.budgetBucketsUsdPerUnit.map((budget) => {
      const underBudget = eligible
        .filter((item) => Number.isFinite(item.effectiveCostPerAcceptedUnitUsd) && item.effectiveCostPerAcceptedUnitUsd <= budget)
        .sort((a, b) =>
          a.effectiveCostPerAcceptedUnitUsd - b.effectiveCostPerAcceptedUnitUsd
          || (b.latestQuality ?? -1) - (a.latestQuality ?? -1)
          || (b.reliability ?? -1) - (a.reliability ?? -1));
      return [String(budget), underBudget.map((item) => item.toolKey)];
    }));
    categories[category.id] = {
      category: category.id,
      title: category.title,
      unit: category.unit,
      qualityThreshold: category.qualityThreshold,
      method: 'Filter to public tools whose latest objective canary passed. Best-quality sorts quality, reliability, effective cost, then latency. Budget routes sort cost first. No payment, affiliate status, or publisher identity affects ordering.',
      bestQuality: byQuality.map((item) => item.toolKey),
      budgetsUsdPerUnit: budgets,
      tools: byQuality,
    };
  }
  return categories;
}
