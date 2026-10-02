import { setTimeout as delay } from 'node:timers/promises';
import { TERMINAL_STATUSES } from './util.mjs';

const API = 'https://api.apify.com/v2';

async function readResponseText(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('response too large');
      throw new Error(`Apify response exceeded the ${maxBytes}-byte safety limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function request(token, method, pathname, { query, body, timeoutMs = 30000, maxResponseBytes = 2_000_000 } = {}) {
  const url = new URL(`${API}${pathname}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await readResponseText(response, maxResponseBytes);
    const parsed = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`Apify ${method} ${pathname} returned ${response.status}: ${parsed?.error?.message ?? text.slice(0, 300)}`);
      error.apifyStatus = response.status;
      throw error;
    }
    return parsed?.data ?? parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStoreItem(actorId) {
  const [username, name] = actorId.split('~');
  const url = new URL(`${API}/store`);
  url.searchParams.set('search', name);
  url.searchParams.set('limit', '50');
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) return null;
  const json = await response.json();
  return json?.data?.items?.find((item) => item.username === username && item.name === name) ?? null;
}

export async function getActor(token, actorId) {
  return request(token, 'GET', `/acts/${actorId}`);
}

export async function startRun(token, actorId, input, maxTotalChargeUsd) {
  return request(token, 'POST', `/acts/${actorId}/runs`, {
    query: { maxTotalChargeUsd, waitForFinish: 0 },
    body: input,
  });
}

export async function getRun(token, runId) {
  return request(token, 'GET', `/actor-runs/${runId}`);
}

export async function pollRun(token, runId, { timeoutMs = 12 * 60 * 1000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await getRun(token, runId);
    if (TERMINAL_STATUSES.has(run.status)) return run;
    await delay(intervalMs);
  }
  const error = new Error(`Timed out waiting for Apify run ${runId}. The reservation remains charged in full until reconciled.`);
  error.code = 'CANARY_RUN_TIMEOUT';
  throw error;
}

export async function abortRun(token, runId) {
  return request(token, 'POST', `/actor-runs/${runId}/abort`, { query: { gracefully: false } });
}

function settlementFingerprint(run) {
  return JSON.stringify({ status: run.status, usageTotalUsd: run.usageTotalUsd ?? null, chargedEventCounts: run.chargedEventCounts ?? null });
}

export async function settleRun(token, runId, { attempts = 4, intervalMs = 5000 } = {}) {
  let previous = null;
  let current = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    current = await getRun(token, runId);
    const fingerprint = settlementFingerprint(current);
    if (fingerprint === previous && TERMINAL_STATUSES.has(current.status)) return { run: current, stable: true };
    previous = fingerprint;
    if (attempt < attempts - 1) await delay(intervalMs);
  }
  return { run: current, stable: false };
}

export async function getDatasetItems(token, datasetId) {
  return request(token, 'GET', `/datasets/${datasetId}/items`, { query: { clean: true, limit: 5 }, maxResponseBytes: 1_000_000 });
}
