import { firstText, getPath, round } from './util.mjs';

function hasErrorValue(value) {
  if (value == null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function signalKind(value) {
  if (value === true) return 'success';
  if (value === false) return 'failure';
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['success', 'succeeded', 'ok', 'completed', 'complete'].includes(normalized)) return 'success';
  if (['failed', 'failure', 'error', 'timed-out', 'aborted'].includes(normalized)) return 'failure';
  return null;
}

export function validateOutputContract(items, tool) {
  for (const item of items) {
    for (const dotted of tool.errorPaths ?? []) {
      const value = getPath(item, dotted);
      if (hasErrorValue(value)) return { accepted: false, reason: `Output reported an error at ${dotted}.` };
    }
  }
  let sawSignal = false;
  let sawSuccess = false;
  for (const item of items) {
    for (const dotted of tool.successPaths ?? []) {
      const kind = signalKind(getPath(item, dotted));
      if (!kind) continue;
      sawSignal = true;
      if (kind === 'failure') return { accepted: false, reason: `Output reported failure at ${dotted}.` };
      if (kind === 'success') sawSuccess = true;
    }
  }
  if (sawSignal && !sawSuccess) return { accepted: false, reason: 'Output did not report a successful status.' };
  return { accepted: true, reason: null };
}

export function normalizeWords(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenRecall(actual, expectedTokens) {
  const have = new Set(normalizeWords(actual));
  const expected = expectedTokens.map((token) => normalizeWords(token)[0]).filter(Boolean);
  const found = expected.filter((token) => have.has(token));
  return { score: expected.length ? found.length / expected.length : 0, found, missing: expected.filter((token) => !have.has(token)) };
}

export function wordErrorRate(actual, expected) {
  const a = normalizeWords(actual);
  const b = normalizeWords(expected);
  if (!b.length) return { wer: a.length ? 1 : 0, distance: a.length, expectedWords: 0, actualWords: a.length };
  const previous = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let row = 1; row <= b.length; row += 1) {
    const current = [row];
    for (let col = 1; col <= a.length; col += 1) {
      current[col] = Math.min(
        current[col - 1] + 1,
        previous[col] + 1,
        previous[col - 1] + (b[row - 1] === a[col - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  const distance = previous[a.length];
  return { wer: distance / b.length, distance, expectedWords: b.length, actualWords: a.length };
}

export function evaluateOutput(category, tool, items) {
  const contract = validateOutputContract(items, tool);
  if (!contract.accepted) return { accepted: false, quality: 0, extractedText: '', reason: contract.reason };
  const text = firstText(items, tool.textPaths);
  if (!text) return { accepted: false, quality: 0, extractedText: '', reason: 'No documented text field contained output.' };
  if (category.id === 'document-to-markdown') {
    const detail = tokenRecall(text, category.fixture.expectedTokens);
    return {
      accepted: detail.score >= category.qualityThreshold,
      quality: round(detail.score, 4),
      extractedText: text.slice(0, 1000),
      reason: detail.missing.length ? `Missing expected token(s): ${detail.missing.join(', ')}` : 'All expected fixture tokens were present.',
      evidence: detail,
    };
  }
  if (category.id === 'audio-to-text') {
    const references = category.fixture.expectedTexts ?? [category.fixture.expectedText];
    const alternatives = references.map((reference) => ({ reference, ...wordErrorRate(text, reference) }));
    const detail = alternatives.sort((a, b) => a.wer - b.wer)[0];
    const quality = Math.max(0, 1 - detail.wer);
    return {
      accepted: quality >= category.qualityThreshold,
      quality: round(quality, 4),
      extractedText: text.slice(0, 1500),
      reason: `Word error rate ${round(detail.wer, 4)} against the published reference transcript.`,
      evidence: { ...detail, acceptedReference: detail.reference, publishedReferenceCount: references.length },
    };
  }
  throw new Error(`Unknown category scorer: ${category.id}`);
}

export function priceForEvent(event, plan = 'FREE') {
  if (Number.isFinite(event?.eventPriceUsd)) return event.eventPriceUsd;
  const tiers = event?.eventTieredPricingUsd;
  return tiers?.[plan]?.tieredEventPriceUsd ?? tiers?.FREE?.tieredEventPriceUsd ?? null;
}

export function calculateRunCost({ run, pricingInfo, fallbackEventPrices = {}, units = 1, plan = 'FREE' }) {
  const counts = run?.chargedEventCounts ?? {};
  const events = pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {};
  let eventCostUsd = 0;
  let unknown = false;
  const lines = [];
  for (const [name, rawCount] of Object.entries(counts)) {
    const count = Number(rawCount) || 0;
    const live = priceForEvent(events[name], plan);
    const fallback = fallbackEventPrices[name];
    const price = Number.isFinite(live) ? live : (Number.isFinite(fallback) ? fallback : null);
    if (count > 0 && price == null) unknown = true;
    const subtotal = price == null ? null : count * price;
    if (subtotal != null) eventCostUsd += subtotal;
    lines.push({ event: name, count, priceUsd: price, subtotalUsd: round(subtotal) });
  }
  const usageTotalUsd = Number.isFinite(run?.usageTotalUsd) ? run.usageTotalUsd : null;
  const buyerPaysUsage = pricingInfo?.isPPEPlatformUsagePaidByUser === true;
  let total = eventCostUsd;
  if (pricingInfo?.pricingModel !== 'PAY_PER_EVENT' || buyerPaysUsage) {
    if (usageTotalUsd == null) unknown = true;
    else total += usageTotalUsd;
  }
  if (!Object.keys(counts).length && usageTotalUsd != null) total = usageTotalUsd;
  return {
    chargedEvents: lines,
    eventCostUsd: round(eventCostUsd),
    usageTotalUsd: round(usageTotalUsd),
    buyerPaysPlatformUsage: buyerPaysUsage,
    totalCostUsd: unknown ? null : round(total),
    costPerUnitUsd: unknown || !units ? null : round(total / units),
    costKnown: !unknown,
  };
}
