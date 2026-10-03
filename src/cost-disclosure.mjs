export const SIMULATED_FREE_TIER_PRICE_NOTE = 'simulated FREE-tier price — owner run was exempt';

export function isSimulatedFreeTierPrice(result) {
  if (result?.cost?.isSimulated === true) return true;
  if (!result?.ownedByPublisher) return false;
  if (!Number.isFinite(result?.cost?.comparativeCostUsd)) return false;
  return /simulat|owner run was exempt|publisher is exempt/i.test(result?.cost?.simulationNote ?? result?.cost?.note ?? '');
}

export function annotateResultCost(result) {
  if (!result?.cost) return result;
  const isSimulated = isSimulatedFreeTierPrice(result);
  return {
    ...result,
    cost: {
      ...result.cost,
      isSimulated,
      simulationNote: isSimulated ? SIMULATED_FREE_TIER_PRICE_NOTE : null,
    },
  };
}

export function annotateRunCosts(run) {
  if (!Array.isArray(run?.results)) return run;
  return { ...run, results: run.results.map(annotateResultCost) };
}
