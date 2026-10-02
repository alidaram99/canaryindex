import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readJson } from './util.mjs';

export async function submitIndexNow({ configFile, publicRepoDir }) {
  const config = await readJson(configFile);
  const sitemap = await readFile(path.join(publicRepoDir, 'docs', 'sitemap.xml'), 'utf8');
  const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (!urlList.length) throw new Error('No URLs found in generated sitemap.xml.');
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(config.siteUrl).host,
      key: config.indexNowKey,
      keyLocation: `${config.siteUrl}${config.indexNowKey}.txt`,
      urlList,
    }),
  });
  const text = await response.text();
  if (![200, 202].includes(response.status)) throw new Error(`IndexNow returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return { status: response.status, submitted: urlList.length };
}
