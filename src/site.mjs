import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { annotateRunCosts, SIMULATED_FREE_TIER_PRICE_NOTE } from './cost-disclosure.mjs';
import { readHistory, recommendations, summarizeTools } from './history.mjs';
import { escapeHtml, listJsonFiles, readJson, writeJson } from './util.mjs';

const STYLE = `:root{color-scheme:dark;--bg:#08111d;--card:#101d2d;--line:#233852;--text:#edf5ff;--muted:#9db0c6;--accent:#72e6a8;--warn:#ffd166;--bad:#ff7b86}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#123354 0,#08111d 42%);color:var(--text);font:16px/1.6 system-ui,sans-serif}main,header,footer{width:min(1120px,92vw);margin:auto}header{padding:56px 0 28px}h1{font-size:clamp(2.5rem,8vw,5.5rem);line-height:.95;margin:.2em 0}h2{margin-top:2.2em}.eyebrow,.pill{color:var(--accent);font-weight:750;letter-spacing:.08em;text-transform:uppercase}.lede{font-size:1.2rem;max-width:850px;color:var(--muted)}nav a,a{color:#90d8ff}nav{display:flex;gap:18px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.card{background:linear-gradient(145deg,#122338,#0d1928);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 40px #0005}.metric{font-size:2rem;font-weight:800}.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;background:#0d1928;border-radius:14px;overflow:hidden}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--accent)}code{background:#07101a;padding:.15em .4em;border-radius:5px}.ok{color:var(--accent)}.bad{color:var(--bad)}.warn{color:var(--warn)}footer{padding:60px 0;color:var(--muted)}footer p{margin:.35em 0}.banner{border-left:4px solid var(--warn);padding:12px 18px;background:#2a2215;margin:22px 0}.disclosure{border-left-color:#90d8ff;background:#10243a}.small{font-size:.9rem}blockquote{margin:18px 0;padding:18px 22px;border-left:4px solid var(--accent);background:#0d1928;border-radius:0 12px 12px 0}details{background:#0d1928;border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:10px 0}summary{font-weight:750;cursor:pointer}`;

const SIBLINGS = [
  ['Project hub', 'https://alidaram99.github.io/'],
  ['DoneLatch', 'https://alidaram99.github.io/donelatch/'],
  ['ExactGround', 'https://alidaram99.github.io/exactground/'],
  ['Waraq', 'https://alidaram99.github.io/waraqmd/'],
  ['Guide: which MCP server actually works today?', 'https://alidaram99.github.io/api-alternatives/mcp-server-reliability/'],
];

function shell(config, title, description, body, relative = '', structuredData = []) {
  const canonical = new URL(relative, config.siteUrl).href;
  const page = {
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    isAccessibleForFree: true,
    license: 'https://opensource.org/license/mit',
    author: { '@type': 'Person', name: 'Ali Daram', url: 'https://github.com/alidaram99' },
  };
  const jsonLd = { '@context': 'https://schema.org', '@graph': [page, ...structuredData] };
  const prefix = relative ? '../'.repeat(relative.split('/').filter(Boolean).length) : '';
  const siblingLinks = SIBLINGS.map(([name, url]) => `<a href="${url}">${escapeHtml(name)}</a>`).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${canonical}"><link rel="stylesheet" href="${prefix}assets/style.css"><script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script></head><body><header><nav><a href="${prefix}index.html">Scorecards</a><a href="${prefix}method/index.html">Method</a><a href="${prefix}api/recommendations.json">Agent JSON</a><a href="${config.repositoryUrl}">GitHub</a></nav></header><main>${body}</main><footer><p>CanaryIndex · public evidence, not a certification · method ${escapeHtml(config.methodVersion)}</p><p>${siblingLinks}</p></footer></body></html>`;
}

function formatMoney(value) {
  return Number.isFinite(value) ? `$${value.toFixed(Math.max(3, value < 0.01 ? 5 : 3))}` : 'unknown';
}

function simulationLabel(isSimulated) {
  return isSimulated ? ` <span class="warn">(${escapeHtml(SIMULATED_FREE_TIER_PRICE_NOTE)})</span>` : '';
}

function toolCard(tool) {
  const unavailable = tool.latestRunStatus === 'FAILED_TO_OBSERVE';
  const status = unavailable
    ? '<span class="warn">FAILED TO OBSERVE</span>'
    : tool.latestAccepted ? '<span class="ok">PASS</span>' : '<span class="bad">NO PASS</span>';
  return `<article class="card"><div class="pill">${escapeHtml(tool.category)}</div><h3><a href="tools/${tool.toolKey}/index.html">${escapeHtml(tool.displayName)}</a></h3><div class="metric">${status}</div><p>Quality: <strong>${tool.latestQuality == null ? 'unknown' : `${Math.round(tool.latestQuality * 100)}%`}</strong> · reliability: <strong>${tool.reliability == null ? 'unknown' : `${Math.round(tool.reliability * 100)}% (${tool.acceptedRuns}/${tool.observations})`}</strong></p><p>Effective cost per accepted unit: <strong>${formatMoney(tool.effectiveCostPerAcceptedUnitUsd)}</strong>${simulationLabel(tool.effectiveCostIsSimulated)}</p><p>Median latency: <strong>${Number.isFinite(tool.medianLatencyMs) ? `${(tool.medianLatencyMs / 1000).toFixed(2)} s` : 'unknown'}</strong></p><p class="small">${tool.ownedByPublisher ? '<span class="warn">Publisher-owned tool — disclosed, never boosted.</span>' : 'Independently owned.'}</p></article>`;
}

function recommendationStatements(config, summaries, recs, observedDate) {
  return config.categories.map((category) => {
    const bestKey = recs[category.id]?.bestQuality?.[0];
    const best = summaries.find((tool) => tool.toolKey === bestKey);
    const statement = best
      ? `As of ${observedDate}, CanaryIndex recommends ${best.displayName} as the current best-quality measured public option for ${category.title}, at ${formatMoney(best.effectiveCostPerAcceptedUnitUsd)} per accepted ${category.unit}${best.effectiveCostIsSimulated ? ` (${SIMULATED_FREE_TIER_PRICE_NOTE})` : ''}.`
      : `As of ${observedDate}, CanaryIndex makes no public recommendation for ${category.title}: no listed public tool has a current passing observation under method ${config.methodVersion}.`;
    return { category, best, statement };
  });
}

function faqEntries(config, recommendationText, observedDate) {
  return [
    {
      question: 'Which document-to-Markdown or transcription tool for AI agents actually works?',
      answer: `${recommendationText} This answer reflects the public evidence dated ${observedDate}, not a permanent certification.`,
    },
    {
      question: 'Are CanaryIndex publisher-owned Actors included?',
      answer: 'Yes. Drop-in APIs Actors are prominently labeled, run against the same fixtures, receive no ranking boost, and are excluded from recommendations while private.',
    },
    {
      question: 'Does failed to observe mean the tool failed?',
      answer: 'No. Failed to observe means CanaryIndex could not obtain a valid measurement, for example because the current Apify plan returned HTTP 403. It is not scored as a product failure.',
    },
    {
      question: 'How does CanaryIndex rank agent tools?',
      answer: 'A recommendation requires a public listing and a current passing canary. Best-quality ordering uses quality, reliability, effective cost, then latency. Payment, sponsorship and ownership are excluded.',
    },
    {
      question: 'Can an AI agent read CanaryIndex without an API key?',
      answer: `Yes. Fetch ${config.siteUrl}api/recommendations.json. The JSON, method and raw evidence are public and static.`,
    },
  ];
}

function home(config, summaries, runs, recs) {
  const latest = runs.at(-1);
  const observedDate = (latest?.finishedAt ?? latest?.startedAt ?? 'no completed run').slice(0, 10);
  const statements = recommendationStatements(config, summaries, recs, observedDate);
  const recommendationText = statements.map(({ statement }) => statement).join(' ');
  const faqs = faqEntries(config, recommendationText, observedDate);
  const planBlocked = latest?.results?.some((result) => result.httpStatus === 403 && /plan does not support running public Actors/i.test(result.reason ?? ''));
  const observationNotice = planBlocked
    ? '<div class="banner"><strong>Current observation limit:</strong> this account uses Apify Creator, whose <a href="https://apify.com/pricing/creator-plan">official plan page</a> limits execution to the publisher’s own Actors and Apify Universal Actors. Third-party attempts therefore return HTTP 403. These are marked failed to observe—not failed tools—and no recommendation is emitted without a real passing observation.</div>'
    : '';
  const tables = config.categories.map((category) => {
    const tools = summaries.filter((item) => item.category === category.id);
    return `<section><h2>${escapeHtml(category.title)}</h2><p class="muted">One fixed public fixture · pass threshold ${Math.round(category.qualityThreshold * 100)}% · unit: ${escapeHtml(category.unit)}.</p><div class="grid">${tools.map(toolCard).join('')}</div><p><a href="api/categories/${category.id}.json">Machine-readable category scorecard →</a></p></section>`;
  }).join('');
  const quotes = statements.map(({ statement }) => `<blockquote><p>“${escapeHtml(statement)}”</p><cite>Generated from <a href="api/recommendations.json">recommendations.json</a></cite></blockquote>`).join('');
  const faqHtml = faqs.map(({ question, answer }) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('');
  const dataset = {
    '@type': 'Dataset',
    name: 'CanaryIndex live AI-agent tool scorecards',
    description: 'Versioned live observations of document-to-Markdown and transcription tools, including output quality, availability, latency, comparative cost and raw evidence.',
    url: config.siteUrl,
    dateModified: latest?.finishedAt ?? latest?.startedAt ?? undefined,
    creator: { '@type': 'Person', name: 'Ali Daram', url: 'https://github.com/alidaram99' },
    license: 'https://opensource.org/license/mit',
    isAccessibleForFree: true,
    variableMeasured: ['output quality', 'observation availability', 'latency', 'effective cost', 'reliability'],
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${config.siteUrl}api/recommendations.json` },
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${config.siteUrl}data/latest.json` },
    ],
  };
  const faqPage = {
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })),
  };
  const itemList = {
    '@type': 'ItemList',
    name: 'AI-agent tool scorecards measured by CanaryIndex',
    numberOfItems: summaries.length,
    itemListElement: summaries.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: tool.displayName,
      url: `${config.siteUrl}tools/${tool.toolKey}/`,
    })),
  };
  const description = 'Which document-to-Markdown or transcription tool for AI agents actually works? CanaryIndex publishes reproducible quality, cost, latency and raw evidence.';
  const body = `<div class="eyebrow">Evidence before routing</div><h1>${config.brand}</h1><p class="lede"><strong>CanaryIndex answers “which document-to-Markdown or transcription tool for AI agents actually works?”</strong> by running the same public file through each compatible tool and publishing quality, cost, latency and raw evidence—including when a tool could not be measured.</p><div class="banner"><strong>Scope:</strong> only document → Markdown and audio/video → text in v0.1. A pass is evidence for this fixture and method version, not a security or universal quality certification.</div><div class="banner disclosure"><strong>Publisher disclosure:</strong> Drop-in APIs Actors belong to the same publisher as CanaryIndex. They are labeled on every card, use the same scoring rules, receive no ranking advantage, and remain ineligible while private. <a href="method/index.html">Read the complete ranking rules.</a></div>${observationNotice}<section><h2>Current recommendations</h2>${quotes}</section><div class="grid"><div class="card"><div class="metric">${runs.length}</div><div>published benchmark run(s)</div></div><div class="card"><div class="metric">${summaries.filter((item) => item.latestAccepted).length}/${summaries.length}</div><div>latest objective canaries passed</div></div><div class="card"><div class="metric">$${config.monthlyBudgetUsd}</div><div>hard monthly canary budget cap</div></div></div>${tables}<section><h2>Direct answer for agents</h2><p>Fetch <code>${config.siteUrl}api/recommendations.json</code>. Rankings require a current passing canary and public listing; sponsorship and ownership are never ranking inputs.</p><pre><code>${escapeHtml(JSON.stringify({ endpoint: `${config.siteUrl}api/recommendations.json`, observedAt: latest?.finishedAt ?? null, answers: statements.map(({ category, statement }) => ({ category: category.id, statement })) }, null, 2))}</code></pre></section><section id="faq"><h2>Frequently asked questions</h2>${faqHtml}</section>`;
  return shell(config, `${config.brand}: ${config.tagline}`, description, body, '', [dataset, faqPage, itemList]);
}

function methodPage(config) {
  const rows = config.categories.map((category) => `<tr><td>${escapeHtml(category.title)}</td><td><a href="${category.fixture.sourcePage}">${escapeHtml(category.fixture.id)}</a></td><td>${Math.round(category.qualityThreshold * 100)}%</td><td>${escapeHtml(category.fixture.licenseNote)}</td></tr>`).join('');
  const body = `<div class="eyebrow">Reproduce before trusting</div><h1>Method & neutrality</h1><p class="lede">CanaryIndex publishes the fixtures, thresholds, raw observations, ownership disclosures and deterministic ranking rules behind every answer. A missing observation never becomes a pass.</p><h2>What is measured</h2><table><thead><tr><th>Category</th><th>Fixture</th><th>Pass threshold</th><th>Rights</th></tr></thead><tbody>${rows}</tbody></table><h2>Objective scores</h2><ul><li>Document quality is exact expected-token recall on a one-page W3C fixture.</li><li>Transcription quality is <code>1 − word error rate</code> against the best match among two published interpretations of the short, historically ambiguous NASA phrase.</li><li>Reliability is accepted canaries divided by completed observations. Monitoring failures are visible but do not become product failures.</li><li>Effective cost per accepted unit includes comparative spend from failed completed observations.</li><li>Publisher-owned Actors use the same scorer. Their simulated public price is labeled because Apify exempts owner self-runs from custom events.</li></ul><h2>Published ranking rules</h2><ol><li>Require a public listing and a current passing canary.</li><li>Best-quality order: quality, historical reliability, effective cost, then latency.</li><li>Budget routes: filter at the requested ceiling, then sort cost, quality and reliability.</li><li>Exclude payment, sponsorship, affiliate status and publisher ownership from every ordering.</li></ol><h2>Budget safety</h2><p>Before every call, its configured worst-case cap ($0.02–$0.15 in v0.1) is reserved in a public ledger. Pending or unknown reservations retain their full value. One complete weekly suite can reserve at most $${config.tools.reduce((sum, tool) => sum + (tool.maxChargeUsd ?? config.perRunMaxChargeUsd), 0).toFixed(2)}; the UTC monthly cap is $${config.monthlyBudgetUsd}. Only PAY_PER_EVENT Actors are called, and each receives <code>maxTotalChargeUsd</code>.</p><h2>What a pass does not mean</h2><p>A pass is not a security audit, privacy certification, endorsement, or promise about other inputs. A failed-to-observe result is not a tool failure. Results can drift.</p><p><a href="../api/method.json">Download method JSON</a> · <a href="../data/latest.json">Download latest raw run</a></p>`;
  return shell(config, `Method and neutrality — ${config.brand}`, 'The public scoring, budget, ownership-disclosure and recommendation method used by CanaryIndex.', body, 'method/');
}

function toolPage(config, tool, runs) {
  const observations = runs.flatMap((run) => run.results.filter((item) => item.toolKey === tool.toolKey).map((item) => ({ ...item, observedAt: run.finishedAt ?? run.startedAt })));
  const rows = observations.slice().reverse().map((item) => {
    const verdict = item.runStatus === 'FAILED_TO_OBSERVE' ? 'FAILED TO OBSERVE' : item.accepted ? 'PASS' : 'NO PASS';
    const css = item.runStatus === 'FAILED_TO_OBSERVE' ? 'warn' : item.accepted ? 'ok' : 'bad';
    return `<tr><td>${escapeHtml(item.observedAt)}</td><td class="${css}">${verdict}</td><td>${item.quality == null ? '—' : `${Math.round(item.quality * 100)}%`}</td><td>${formatMoney(item.cost?.comparativeCostPerUnitUsd)}${simulationLabel(item.cost?.isSimulated === true)}</td><td>${Number.isFinite(item.latencyMs) ? `${(item.latencyMs / 1000).toFixed(2)} s` : '—'}</td><td><code>${escapeHtml(item.runStatus)}</code></td></tr>`;
  }).join('');
  const body = `<div class="eyebrow">${escapeHtml(tool.category)}</div><h1>${escapeHtml(tool.displayName)}</h1><p class="lede">Actor: <a href="${tool.storeUrl}">${escapeHtml(tool.actorId)}</a></p>${tool.ownedByPublisher ? '<div class="banner disclosure"><strong>Ownership disclosure:</strong> this tool is published by the same account as CanaryIndex. It receives no ranking advantage and uses the same published scorer.</div>' : '<p>Independently owned; CanaryIndex has no stated financial relationship with this publisher.</p>'}<table><thead><tr><th>Observed</th><th>Verdict</th><th>Quality</th><th>Cost/unit</th><th>Latency</th><th>Run</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No observation yet.</td></tr>'}</tbody></table><h2>Latest reason</h2><p>${escapeHtml(tool.latestReason)}</p><p><a href="../../api/tools/${tool.toolKey}.json">Tool JSON</a> · <a href="../../data/latest.json">Latest raw run</a> · <a href="../../method/index.html">Scoring method</a></p>`;
  const dataset = {
    '@type': 'Dataset',
    name: `${tool.displayName} CanaryIndex observations`,
    description: `Versioned CanaryIndex quality, cost, latency and availability observations for ${tool.actorId}.`,
    url: `${config.siteUrl}tools/${tool.toolKey}/`,
    isAccessibleForFree: true,
    license: 'https://opensource.org/license/mit',
    distribution: { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${config.siteUrl}api/tools/${tool.toolKey}.json` },
  };
  // Keep this short and static — no dynamic PASS/FAIL/status word belongs in the
  // <title>, since that would make a cached/shared title go stale the moment the
  // next observation flips, and SEO titles should stay under ~60 chars.
  return shell(config, `${tool.displayName} — ${config.brand}`, `Reproducible live quality, cost, latency and availability observations for ${tool.actorId}.`, body, `tools/${tool.toolKey}/`, [dataset]);
}

function robotsTxt(config) {
  const agents = ['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Google-Extended'];
  return `${agents.map((agent) => `User-agent: ${agent}\nAllow: /`).join('\n\n')}\n\nUser-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}sitemap.xml\n`;
}

function sitemapXml(urls, lastModified) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc><lastmod>${lastModified}</lastmod></url>`).join('')}</urlset>\n`;
}

function llmsText(config, summaries, recs, latest) {
  const observedDate = (latest?.finishedAt ?? latest?.startedAt ?? 'no completed run').slice(0, 10);
  const statements = recommendationStatements(config, summaries, recs, observedDate);
  const tools = summaries.map((tool) => `- ${tool.displayName}: effective cost per accepted ${config.categories.find((category) => category.id === tool.category)?.unit ?? 'unit'} ${formatMoney(tool.effectiveCostPerAcceptedUnitUsd)}${tool.effectiveCostIsSimulated ? ` (${SIMULATED_FREE_TIER_PRICE_NOTE})` : ''}; ${config.siteUrl}tools/${tool.toolKey}/`).join('\n');
  const siblingText = SIBLINGS.map(([name, url]) => `- ${name}: ${url}`).join('\n');
  return `# CanaryIndex\n\n> CanaryIndex answers which document-to-Markdown or transcription tool for AI agents actually works by publishing reproducible quality, cost, latency and raw evidence.\n\n## Current answers (${observedDate})\n\n${statements.map(({ statement }) => `- ${statement}`).join('\n')}\n\nThese statements are generated from: ${config.siteUrl}api/recommendations.json\n\n## Agent endpoints\n\n- Machine recommendations: ${config.siteUrl}api/recommendations.json\n- Method and ranking rules: ${config.siteUrl}method/\n- Method JSON: ${config.siteUrl}api/method.json\n- Latest raw run: ${config.siteUrl}data/latest.json\n- Repository: ${config.repositoryUrl}\n\n## Neutrality\n\nPublisher-owned Drop-in APIs Actors are included and prominently labeled. Ownership, sponsorship and payment never improve rank. Private tools and tools without a current passing observation are excluded. A failed-to-observe result is not a product failure.\n\n## Tool scorecards\n\n${tools}\n\n## Related projects\n\n${siblingText}\n`;
}

export async function buildSite({ configFile, publicRepoDir }) {
  const config = await readJson(configFile);
  const historyDir = path.join(publicRepoDir, 'data', 'history');
  const docsDir = path.join(publicRepoDir, 'docs');
  const runs = await readHistory(historyDir);
  const summaries = summarizeTools(config, runs);
  const recs = recommendations(config, summaries);
  const latest = runs.at(-1);
  const generatedAt = new Date().toISOString();
  const lastModified = latest?.finishedAt ?? latest?.startedAt ?? generatedAt;
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
    await writeJson(path.join(docsDir, 'api', 'tools', `${tool.toolKey}.json`), { schemaVersion: 1, generatedAt, tool, observations: runs.flatMap((run) => run.results.filter((item) => item.toolKey === tool.toolKey)) });
  }
  const costDisclosure = { booleanField: 'effectiveCostIsSimulated', simulatedFreeTierPriceNote: SIMULATED_FREE_TIER_PRICE_NOTE };
  await writeJson(path.join(docsDir, 'api', 'recommendations.json'), { schemaVersion: 1, generatedAt, methodVersion: config.methodVersion, neutralRanking: true, costDisclosure, categories: recs });
  await writeJson(path.join(docsDir, 'api', 'method.json'), { schemaVersion: 1, methodVersion: config.methodVersion, categories: config.categories, monthlyBudgetUsd: config.monthlyBudgetUsd, perRunMaxChargeUsd: config.perRunMaxChargeUsd, rankingInputs: ['objective quality', 'historical reliability', 'effective cost per accepted unit', 'latency'], excludedInputs: ['payment', 'sponsorship', 'affiliate relationship', 'publisher ownership'], costDisclosure });
  for (const category of config.categories) await writeJson(path.join(docsDir, 'api', 'categories', `${category.id}.json`), recs[category.id]);
  await mkdir(path.join(docsDir, 'data', 'history'), { recursive: true });
  for (const historyFile of await listJsonFiles(historyDir)) {
    await writeJson(path.join(docsDir, 'data', 'history', path.basename(historyFile)), annotateRunCosts(await readJson(historyFile)));
  }
  if (latest) await writeJson(path.join(docsDir, 'data', 'latest.json'), annotateRunCosts(latest));
  else await writeJson(path.join(docsDir, 'data', 'latest.json'), { schemaVersion: 1, status: 'NO_RUNS_YET', results: [] });
  // Only canonical HTML pages belong in the XML sitemap. api/recommendations.json
  // and data/latest.json are machine endpoints — they're advertised in llms.txt
  // (see llmsText() above), not here.
  const urls = [
    config.siteUrl,
    `${config.siteUrl}method/`,
    ...summaries.map((tool) => `${config.siteUrl}tools/${tool.toolKey}/`),
  ];
  await writeFile(path.join(docsDir, 'sitemap.xml'), sitemapXml(urls, lastModified), 'utf8');
  await writeFile(path.join(docsDir, 'robots.txt'), robotsTxt(config), 'utf8');
  await writeFile(path.join(docsDir, 'llms.txt'), llmsText(config, summaries, recs, latest), 'utf8');
  await writeFile(path.join(docsDir, `${config.indexNowKey}.txt`), config.indexNowKey, 'utf8');
  await writeFile(path.join(docsDir, '.nojekyll'), '', 'utf8');
  return { config, runs, summaries, recommendations: recs, docsDir, urls };
}
