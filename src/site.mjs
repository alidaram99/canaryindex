import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readHistory, recommendations, summarizeTools } from './history.mjs';
import { escapeHtml, readJson, writeJson } from './util.mjs';

const STYLE = `:root{color-scheme:dark;--bg:#08111d;--card:#101d2d;--line:#233852;--text:#edf5ff;--muted:#9db0c6;--accent:#72e6a8;--warn:#ffd166;--bad:#ff7b86}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#123354 0,#08111d 42%);color:var(--text);font:16px/1.6 system-ui,sans-serif}main,header,footer{width:min(1120px,92vw);margin:auto}header{padding:56px 0 28px}h1{font-size:clamp(2.5rem,8vw,5.5rem);line-height:.95;margin:.2em 0}h2{margin-top:2.2em}.eyebrow,.pill{color:var(--accent);font-weight:750;letter-spacing:.08em;text-transform:uppercase}.lede{font-size:1.2rem;max-width:760px;color:var(--muted)}nav a,a{color:#90d8ff}nav{display:flex;gap:18px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.card{background:linear-gradient(145deg,#122338,#0d1928);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 40px #0005}.metric{font-size:2rem;font-weight:800}.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;background:#0d1928;border-radius:14px;overflow:hidden}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--accent)}code{background:#07101a;padding:.15em .4em;border-radius:5px}.ok{color:var(--accent)}.bad{color:var(--bad)}.warn{color:var(--warn)}footer{padding:60px 0;color:var(--muted)}.banner{border-left:4px solid var(--warn);padding:12px 18px;background:#2a2215;margin:22px 0}.tool-list{padding:0;list-style:none}.tool-list li{margin:9px 0}.small{font-size:.9rem}`;

function shell(config, title, description, body, relative = '') {
  const canonical = new URL(relative, config.siteUrl).href;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': relative.startsWith('tools/') ? 'Dataset' : 'WebSite',
    name: title,
    description,
    url: canonical,
    creator: { '@type': 'Person', name: 'Ali Daram', url: 'https://github.com/alidaram99' },
    isAccessibleForFree: true,
    license: 'https://opensource.org/license/mit',
  };
  const prefix = relative ? '../'.repeat(relative.split('/').filter(Boolean).length) : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${canonical}"><link rel="stylesheet" href="${prefix}assets/style.css"><script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script></head><body><header><nav><a href="${prefix}index.html">Scorecards</a><a href="${prefix}method/index.html">Method</a><a href="${prefix}api/recommendations.json">Agent JSON</a><a href="${config.repositoryUrl}">GitHub</a></nav></header><main>${body}</main><footer>CanaryIndex · public evidence, not a certification · method ${escapeHtml(config.methodVersion)}</footer></body></html>`;
}

function formatMoney(value) {
  return Number.isFinite(value) ? `$${value.toFixed(Math.max(3, value < 0.01 ? 5 : 3))}` : 'unknown';
}

function toolCard(tool) {
  const status = tool.latestAccepted ? '<span class="ok">PASS</span>' : '<span class="bad">NO PASS</span>';
  return `<article class="card"><div class="pill">${escapeHtml(tool.category)}</div><h3><a href="tools/${tool.toolKey}/index.html">${escapeHtml(tool.displayName)}</a></h3><div class="metric">${status}</div><p>Quality: <strong>${tool.latestQuality == null ? 'unknown' : `${Math.round(tool.latestQuality * 100)}%`}</strong> · reliability: <strong>${tool.reliability == null ? 'unknown' : `${Math.round(tool.reliability * 100)}% (${tool.acceptedRuns}/${tool.observations})`}</strong></p><p>Effective cost per accepted unit: <strong>${formatMoney(tool.effectiveCostPerAcceptedUnitUsd)}</strong></p><p>Median latency: <strong>${Number.isFinite(tool.medianLatencyMs) ? `${(tool.medianLatencyMs / 1000).toFixed(2)} s` : 'unknown'}</strong></p><p class="small">${tool.ownedByPublisher ? '<span class="warn">Publisher-owned tool — disclosed, never boosted.</span>' : 'Independently owned.'}</p></article>`;
}

function home(config, summaries, runs, recs) {
  const latest = runs.at(-1);
  const planBlocked = latest?.results?.some((result) => result.httpStatus === 403 && /plan does not support running public Actors/i.test(result.reason ?? ''));
  const observationNotice = planBlocked
    ? '<div class="banner"><strong>Current observation limit:</strong> the publisher account can run its own Actors, but Apify currently returns HTTP 403 for third-party public Actors on this plan. These are marked failed to observe—not failed tools—and no recommendation is emitted without a real passing observation.</div>'
    : '';
  const tables = config.categories.map((category) => {
    const tools = summaries.filter((item) => item.category === category.id);
    return `<section><h2>${escapeHtml(category.title)}</h2><p class="muted">One fixed public fixture · pass threshold ${Math.round(category.qualityThreshold * 100)}% · unit: ${escapeHtml(category.unit)}.</p><div class="grid">${tools.map(toolCard).join('')}</div><p><a href="api/categories/${category.id}.json">Machine-readable category scorecard →</a></p></section>`;
  }).join('');
  return shell(config, `${config.brand}: ${config.tagline}`, 'Independent weekly evidence for document conversion and transcription tools used by AI agents: output quality, reliability, latency and effective cost.', `<div class="eyebrow">Evidence before routing</div><h1>${config.brand}</h1><p class="lede">Which AI-agent tool actually works, at what effective cost? CanaryIndex reruns the same public canaries, publishes raw evidence, and never sells ranking position.</p><div class="banner"><strong>Scope:</strong> only document → Markdown and audio/video → text in v0.1. A pass is evidence for this fixture and method version, not a security or universal quality certification.</div>${observationNotice}<div class="grid"><div class="card"><div class="metric">${runs.length}</div><div>published benchmark run(s)</div></div><div class="card"><div class="metric">${summaries.filter((item) => item.latestAccepted).length}/${summaries.length}</div><div>latest objective canaries passed</div></div><div class="card"><div class="metric">$${config.monthlyBudgetUsd}</div><div>hard monthly canary budget cap</div></div></div>${tables}<section><h2>Direct answer for agents</h2><p>Fetch <code>${config.siteUrl}api/recommendations.json</code>. Filter by category and your maximum cost per unit. Rankings require a current passing canary and ignore sponsorship and ownership.</p><pre><code>${escapeHtml(JSON.stringify({ endpoint: `${config.siteUrl}api/recommendations.json`, generatedAt: latest?.finishedAt ?? null, categories: Object.keys(recs) }, null, 2))}</code></pre></section>`, '');
}

function methodPage(config) {
  const rows = config.categories.map((category) => `<tr><td>${escapeHtml(category.title)}</td><td><a href="${category.fixture.sourcePage}">${escapeHtml(category.fixture.id)}</a></td><td>${Math.round(category.qualityThreshold * 100)}%</td><td>${escapeHtml(category.fixture.licenseNote)}</td></tr>`).join('');
  return shell(config, `Method and neutrality — ${config.brand}`, 'The public scoring, budget, ownership-disclosure and recommendation method used by CanaryIndex.', `<div class="eyebrow">Reproduce before trusting</div><h1>Method & neutrality</h1><h2>What is measured</h2><table><thead><tr><th>Category</th><th>Fixture</th><th>Pass threshold</th><th>Rights</th></tr></thead><tbody>${rows}</tbody></table><h2>Objective scores</h2><ul><li>Document quality is exact expected-token recall on a one-page W3C fixture.</li><li>Transcription quality is <code>1 − word error rate</code> against the best match among two published interpretations of the short, historically ambiguous NASA phrase. Both references are visible in method JSON.</li><li>Reliability is accepted canaries divided by all completed observations. Missing scheduled runs are missing evidence, never passes.</li><li>Effective cost per accepted unit includes spend from failed observations; public PPE event counts and prices drive comparative cost.</li><li>For our own Actors, Apify exempts the owner from custom events. Their public event price is therefore simulated from delivered units and prominently labeled; raw self-run event counts remain available.</li></ul><h2>Recommendation rules</h2><p>First require a public listing and a current passing canary. “Best quality” sorts quality, historical reliability, effective cost, then latency. Budget routes filter at the requested price ceiling and sort cost, quality, then reliability. Publisher identity, sponsorship and affiliate payments are absent from the algorithm.</p><h2>Budget safety</h2><p>Before every call, its configured worst-case cap ($0.02–$0.15 in v0.1) is reserved in a public append-only ledger. Pending or unknown reservations retain their full value. One complete weekly suite can reserve at most $${config.tools.reduce((sum, tool) => sum + (tool.maxChargeUsd ?? config.perRunMaxChargeUsd), 0).toFixed(2)}; the UTC monthly cap is $${config.monthlyBudgetUsd}. Each Actor call also receives <code>maxTotalChargeUsd</code>. A workflow retry reuses the same week/run key and cannot spend twice.</p><h2>What a pass does not mean</h2><p>A pass is not a security audit, privacy certification, endorsement, or promise about other inputs. Results can drift. Tool publishers can reproduce the input, inspect raw output, and improve their tool; nobody can buy a higher score.</p><p><a href="../api/method.json">Download method JSON</a> · <a href="../data/latest.json">Download latest raw run</a></p>`, 'method/');
}

function toolPage(config, tool, runs) {
  const observations = runs.flatMap((run) => run.results.filter((item) => item.toolKey === tool.toolKey).map((item) => ({ ...item, observedAt: run.finishedAt ?? run.startedAt })));
  const rows = observations.slice().reverse().map((item) => `<tr><td>${escapeHtml(item.observedAt)}</td><td class="${item.accepted ? 'ok' : 'bad'}">${item.accepted ? 'PASS' : 'NO PASS'}</td><td>${item.quality == null ? '—' : `${Math.round(item.quality * 100)}%`}</td><td>${formatMoney(item.cost?.comparativeCostPerUnitUsd)}</td><td>${Number.isFinite(item.latencyMs) ? `${(item.latencyMs / 1000).toFixed(2)} s` : '—'}</td><td><code>${escapeHtml(item.runStatus)}</code></td></tr>`).join('');
  return shell(config, `${tool.displayName} live scorecard — ${config.brand}`, `Reproducible live quality, cost, latency and reliability observations for ${tool.actorId}.`, `<div class="eyebrow">${escapeHtml(tool.category)}</div><h1>${escapeHtml(tool.displayName)}</h1><p class="lede">Actor: <a href="${tool.storeUrl}">${escapeHtml(tool.actorId)}</a></p>${tool.ownedByPublisher ? '<div class="banner"><strong>Ownership disclosure:</strong> this tool is published by the same account that publishes CanaryIndex. It receives no ranking advantage. Public-price simulation is labeled because owner self-runs are exempt from custom events.</div>' : '<p>Independently owned; CanaryIndex has no stated financial relationship with this publisher.</p>'}<table><thead><tr><th>Observed</th><th>Verdict</th><th>Quality</th><th>Cost/unit</th><th>Latency</th><th>Run</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No observation yet.</td></tr>'}</tbody></table><h2>Latest reason</h2><p>${escapeHtml(tool.latestReason)}</p><p><a href="../../api/tools/${tool.toolKey}.json">Tool JSON</a> · <a href="../../data/latest.json">Latest raw run</a> · <a href="../../method/index.html">Scoring method</a></p>`, `tools/${tool.toolKey}/`);
}

export async function buildSite({ configFile, publicRepoDir }) {
  const config = await readJson(configFile);
  const historyDir = path.join(publicRepoDir, 'data', 'history');
  const docsDir = path.join(publicRepoDir, 'docs');
  const runs = await readHistory(historyDir);
  const summaries = summarizeTools(config, runs);
  const recs = recommendations(config, summaries);
  await rm(docsDir, { recursive: true, force: true });
  await mkdir(path.join(docsDir, 'assets'), { recursive: true });
  await mkdir(path.join(docsDir, 'method'), { recursive: true });
  await mkdir(path.join(docsDir, 'api', 'categories'), { recursive: true });
  await mkdir(path.join(docsDir, 'api', 'tools'), { recursive: true });
  await mkdir(path.join(docsDir, 'tools'), { recursive: true });
  await writeFile(path.join(docsDir, 'assets', 'style.css'), STYLE, 'utf8');
  await writeFile(path.join(docsDir, 'index.html'), home(config, summaries, runs, recs), 'utf8');
  await writeFile(path.join(docsDir, 'method', 'index.html'), methodPage(config), 'utf8');
  for (const tool of summaries) {
    const directory = path.join(docsDir, 'tools', tool.toolKey);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), toolPage(config, tool, runs), 'utf8');
    await writeJson(path.join(docsDir, 'api', 'tools', `${tool.toolKey}.json`), { schemaVersion: 1, generatedAt: new Date().toISOString(), tool, observations: runs.flatMap((run) => run.results.filter((item) => item.toolKey === tool.toolKey)) });
  }
  const generatedAt = new Date().toISOString();
  await writeJson(path.join(docsDir, 'api', 'recommendations.json'), { schemaVersion: 1, generatedAt, methodVersion: config.methodVersion, neutralRanking: true, categories: recs });
  await writeJson(path.join(docsDir, 'api', 'method.json'), { schemaVersion: 1, methodVersion: config.methodVersion, categories: config.categories, monthlyBudgetUsd: config.monthlyBudgetUsd, perRunMaxChargeUsd: config.perRunMaxChargeUsd, rankingInputs: ['objective quality', 'historical reliability', 'effective cost per accepted unit', 'latency'], excludedInputs: ['payment', 'sponsorship', 'affiliate relationship', 'publisher ownership'] });
  for (const category of config.categories) await writeJson(path.join(docsDir, 'api', 'categories', `${category.id}.json`), recs[category.id]);
  await mkdir(path.join(docsDir, 'data'), { recursive: true });
  await cp(historyDir, path.join(docsDir, 'data', 'history'), { recursive: true, force: true });
  if (runs.length) await writeJson(path.join(docsDir, 'data', 'latest.json'), runs.at(-1));
  else await writeJson(path.join(docsDir, 'data', 'latest.json'), { schemaVersion: 1, status: 'NO_RUNS_YET', results: [] });
  const urls = [config.siteUrl, `${config.siteUrl}method/`, ...summaries.map((tool) => `${config.siteUrl}tools/${tool.toolKey}/`)];
  await writeFile(path.join(docsDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>\n`, 'utf8');
  await writeFile(path.join(docsDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}sitemap.xml\n`, 'utf8');
  await writeFile(path.join(docsDir, 'llms.txt'), `# CanaryIndex\n\n> Neutral, reproducible weekly scorecards for AI-agent tools.\n\nCanaryIndex currently compares document-to-Markdown and audio/video-to-text Apify Actors on fixed public fixtures. It publishes objective output quality, successful-run history, latency, charged-event cost, raw evidence, and ownership disclosures. A pass applies only to the listed fixture and method version. It is not a security or privacy certification. No vendor can pay for placement.\n\nMachine recommendations: ${config.siteUrl}api/recommendations.json\nMethod: ${config.siteUrl}method/\nLatest raw run: ${config.siteUrl}data/latest.json\nRepository: ${config.repositoryUrl}\n`, 'utf8');
  await writeFile(path.join(docsDir, `${config.indexNowKey}.txt`), config.indexNowKey, 'utf8');
  await writeFile(path.join(docsDir, '.nojekyll'), '', 'utf8');
  return { config, runs, summaries, recommendations: recs, docsDir, urls };
}
