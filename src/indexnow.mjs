import { readJson } from './util.mjs';

export async function submitIndexNow({ configFile, publicRepoDir, fetchImpl = fetch }) {
  const config = await readJson(configFile);
  const urlList = [
    config.siteUrl,
    `${config.siteUrl}data/latest.json`,
    `${config.siteUrl}api/recommendations.json`,
  ];
  const response = await fetchImpl('https://api.indexnow.org/indexnow', {
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
  return { status: response.status, submitted: urlList.length, urlList };
}
