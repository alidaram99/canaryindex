import path from 'node:path';
import { listJsonFiles, readJson, round, utcMonth, writeJson } from './util.mjs';

export async function readLedger(ledgerDir) {
  const files = await listJsonFiles(ledgerDir);
  const records = [];
  for (const file of files) {
    const value = await readJson(file);
    if (value?.schemaVersion === 1 && value?.reservationId) records.push({ ...value, _file: file });
  }
  return records;
}

export function effectiveSpend(record) {
  if (record.status === 'completed' && Number.isFinite(record.actualCostUsd)) return record.actualCostUsd;
  return Number(record.reservedUsd) || 0;
}

export function summarizeBudget(records, monthlyCapUsd, month = utcMonth()) {
  const inMonth = records.filter((record) => record.month === month);
  const spentOrReservedUsd = round(inMonth.reduce((sum, record) => sum + effectiveSpend(record), 0));
  return {
    month,
    monthlyCapUsd,
    spentOrReservedUsd,
    remainingUsd: round(Math.max(0, monthlyCapUsd - spentOrReservedUsd)),
    records: inMonth.length,
  };
}

export function findExisting(records, runKey, toolKey, fixtureId) {
  return records.find((record) => record.runKey === runKey && record.toolKey === toolKey && record.fixtureId === fixtureId);
}

export async function reserve({ ledgerDir, runKey, tool, fixture, reservedUsd, monthlyCapUsd, now = new Date() }) {
  const records = await readLedger(ledgerDir);
  const existing = findExisting(records, runKey, tool.key, fixture.id);
  if (existing) return { record: existing, created: false, budget: summarizeBudget(records, monthlyCapUsd, utcMonth(now)) };
  const budget = summarizeBudget(records, monthlyCapUsd, utcMonth(now));
  if (reservedUsd > budget.remainingUsd + 1e-9) throw new Error(`Monthly canary budget exhausted: $${budget.remainingUsd} remains, $${reservedUsd} required.`);
  const reservationId = `${runKey}--${tool.key}--${fixture.id}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const record = {
    schemaVersion: 1,
    reservationId,
    runKey,
    month: utcMonth(now),
    toolKey: tool.key,
    actorId: tool.actorId,
    fixtureId: fixture.id,
    reservedUsd,
    status: 'pending',
    createdAt: now.toISOString(),
    completedAt: null,
    actualCostUsd: null,
    apifyRunId: null,
    note: 'Pending reservations count at their full value until a settled authenticated run supplies a lower verified cost.',
  };
  const file = path.join(ledgerDir, record.month, `${reservationId}.json`);
  await writeJson(file, record);
  return { record: { ...record, _file: file }, created: true, budget };
}

export async function finalizeReservation(record, { actualCostUsd, apifyRunId, status, note, now = new Date() }) {
  const next = {
    ...record,
    _file: undefined,
    status: status === 'settled' && Number.isFinite(actualCostUsd) ? 'completed' : 'unknown',
    completedAt: now.toISOString(),
    actualCostUsd: Number.isFinite(actualCostUsd) ? round(actualCostUsd) : null,
    apifyRunId: apifyRunId ?? null,
    note: note ?? (Number.isFinite(actualCostUsd)
      ? 'Authenticated final run data settled the reservation to the measured buyer cost.'
      : 'Cost was unavailable or unstable; the full reservation remains counted against the monthly cap.'),
  };
  await writeJson(record._file, next);
  return { ...next, _file: record._file };
}
