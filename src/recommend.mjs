export function selectRecommendation(category, { maxCostUsdPerUnit = Infinity, strategy = 'lowest-cost-accepted' } = {}) {
  if (!category) return null;
  const tools = (category.tools ?? []).filter((tool) =>
    tool.latestAccepted
    && tool.publicListing
    && Number.isFinite(tool.effectiveCostPerAcceptedUnitUsd)
    && tool.effectiveCostPerAcceptedUnitUsd <= maxCostUsdPerUnit);
  if (strategy === 'best-quality') {
    tools.sort((a, b) =>
      (b.latestQuality ?? -1) - (a.latestQuality ?? -1)
      || (b.reliability ?? -1) - (a.reliability ?? -1)
      || a.effectiveCostPerAcceptedUnitUsd - b.effectiveCostPerAcceptedUnitUsd
      || (a.medianLatencyMs ?? Infinity) - (b.medianLatencyMs ?? Infinity));
  } else {
    tools.sort((a, b) =>
      a.effectiveCostPerAcceptedUnitUsd - b.effectiveCostPerAcceptedUnitUsd
      || (b.latestQuality ?? -1) - (a.latestQuality ?? -1)
      || (b.reliability ?? -1) - (a.reliability ?? -1));
  }
  return tools[0] ?? null;
}
