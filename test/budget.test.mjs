import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeReservation, readLedger, reserve, summarizeBudget } from '../src/budget.mjs';

test('pending reservations fail closed, dedupe, then settle downward', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'canaryindex-budget-'));
  try {
    const args = { ledgerDir: dir, runKey: 'scheduled-2026-W40', tool: { key: 'tool', actorId: 'u~a' }, fixture: { id: 'fixture' }, reservedUsd: 0.15, monthlyCapUsd: 5, now: new Date('2026-10-03T00:00:00Z') };
    const first = await reserve(args);
    assert.equal(first.created, true);
    const duplicate = await reserve(args);
    assert.equal(duplicate.created, false);
    assert.equal((await readLedger(dir)).length, 1);
    assert.equal(summarizeBudget(await readLedger(dir), 5, '2026-10').spentOrReservedUsd, 0.15);
    await finalizeReservation(first.record, { actualCostUsd: 0.02, apifyRunId: 'run', status: 'settled', now: new Date('2026-10-03T00:02:00Z') });
    assert.equal(summarizeBudget(await readLedger(dir), 5, '2026-10').spentOrReservedUsd, 0.02);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reservation refuses to cross monthly cap', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'canaryindex-cap-'));
  try {
    await reserve({ ledgerDir: dir, runKey: 'one', tool: { key: 'a', actorId: 'u~a' }, fixture: { id: 'f' }, reservedUsd: 4.9, monthlyCapUsd: 5, now: new Date('2026-10-03T00:00:00Z') });
    await assert.rejects(() => reserve({ ledgerDir: dir, runKey: 'two', tool: { key: 'b', actorId: 'u~b' }, fixture: { id: 'f' }, reservedUsd: 0.11, monthlyCapUsd: 5, now: new Date('2026-10-03T00:00:00Z') }), /budget exhausted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
