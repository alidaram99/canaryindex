import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);

export function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function deepReplace(value, needle, replacement) {
  if (typeof value === 'string') return value === needle ? replacement : value;
  if (Array.isArray(value)) return value.map((item) => deepReplace(item, needle, replacement));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item, needle, replacement)]));
  }
  return value;
}

export function getPath(object, dotted) {
  return String(dotted).split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

export function firstText(items, paths) {
  for (const item of items) {
    for (const dotted of paths) {
      const value = getPath(item, dotted);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function listJsonFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return listJsonFiles(full);
      return entry.isFile() && entry.name.endsWith('.json') ? [full] : [];
    }));
    return nested.flat().sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function utcMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function assertSafePublicResult(value) {
  const serialized = JSON.stringify(value);
  const forbidden = [/(?:api[_-]?token|authorization|bearer)\s*["':=]+\s*[^",}\s]+/i, /apify_api_[A-Za-z0-9_-]+/i];
  if (forbidden.some((pattern) => pattern.test(serialized))) throw new Error('Refusing to publish a result that appears to contain a credential.');
  return value;
}
