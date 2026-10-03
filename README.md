# CanaryIndex — live scorecards for AI-agent tools

[![Weekly canaries](https://github.com/alidaram99/apify-income-portfolio/actions/workflows/canaryindex-weekly.yml/badge.svg)](https://github.com/alidaram99/apify-income-portfolio/actions/workflows/canaryindex-weekly.yml)
[![Method: public](https://img.shields.io/badge/method-public-72e6a8)](https://alidaram99.github.io/canaryindex/method/)
[![Budget: capped](https://img.shields.io/badge/monthly%20canary%20budget-%245%20max-ffd166)](https://alidaram99.github.io/canaryindex/method/)

**CanaryIndex runs the same public file through document and transcription tools and publishes the quality, the cost, and the raw result, including when a tool could not be measured.**

It is not another MCP directory and it is not a pay-to-rank “trust score.” The weekly runner calls comparable Apify Actors with fixed public fixtures, calculates objective quality, records latency and charged-event cost, and publishes the raw result history.

- Public scorecards: <https://alidaram99.github.io/canaryindex/>
- Machine recommendations: <https://alidaram99.github.io/canaryindex/api/recommendations.json>
- Method and neutrality policy: <https://alidaram99.github.io/canaryindex/method/>
- Latest raw observation: <https://alidaram99.github.io/canaryindex/data/latest.json>
- Discovery and workflow verification: [docs/DISCOVERY-VERIFY.md](docs/DISCOVERY-VERIFY.md)

## What is covered in v0.1

1. **PDF text-layer → Markdown:** a one-page W3C fixture with exact expected tokens.
2. **Direct audio/video URL → transcript:** a public-domain NASA recording scored by word error rate against two published transcript interpretations.

The initial set is selected from the highest-used compatible Apify Store Actors plus two Actors from the publisher's own portfolio. Our tools are always labeled. They receive no ranking advantage and remain excluded from public recommendations while their Store listings are private.

Website crawlers, OCR-only tools, subtitle extractors and social-video downloaders are deliberately not mixed into these categories.

### Current observation limit

The first live run on 2026-10-03 exposed an account-level constraint rather than hiding it: Apify's official [Creator Plan page](https://apify.com/pricing/creator-plan) limits Creator to the publisher's own Actors and Apify Universal Actors, so third-party public Actor runs return HTTP 403. Those tools are shown as **failed to observe**, not as failed products, and are excluded from recommendations. The cheapest zero-risk mode is public Store statistics only. The first plan explicitly documented as allowing all Actors is Starter at $19/month; a conditional alternative is Apify's experimental [$1-minimum, 14-day x402 prepaid token](https://docs.apify.com/integrations/x402) for eligible pay-per-event, limited-permission, non-Standby Actors. No plan or wallet change is automatic. The raw response and zero-spend reconciliation remain public.

## Ask an agent

No API key is needed to read the static JSON:

```text
Fetch https://alidaram99.github.io/canaryindex/api/recommendations.json
Recommend a public document-to-markdown tool under $0.01 per accepted page.
Explain its latest quality, reliability, cost and observation date.
```

Or from the CLI:

```bash
curl -fsS https://alidaram99.github.io/canaryindex/api/recommendations.json -o recommendations.json
node bin/canaryindex.mjs recommend \
  --json recommendations.json \
  --category document-to-markdown \
  --max-cost 0.01
```

This is MCP-friendly data rather than a fake “static MCP server.” A paid on-demand MCP/Apify runner is intentionally deferred until repeated use proves demand.

## Scoring in one minute

- A canary **passes** only when the Actor run succeeds and the objective output score reaches the category threshold.
- Reliability is accepted canaries divided by completed observations.
- Effective cost per accepted unit includes money spent on failed observations.
- A publisher-exempt self-run is never presented as an observed buyer charge. Its comparative number carries `isSimulated: true` and the label **“simulated FREE-tier price — owner run was exempt”** in HTML, recommendation/tool JSON, published evidence JSON, and `llms.txt`.
- Recommendations require a current pass and a public Store listing.
- Best-quality ordering is quality → reliability → effective cost → latency.
- Budget ordering filters by the caller's ceiling, then sorts cost → quality → reliability.
- Payment, sponsorship, affiliate status and publisher identity are not ranking inputs.

See [METHOD.md](METHOD.md) and the generated [method page](https://alidaram99.github.io/canaryindex/method/) for exact formulas and limitations.

## Budget safety

The runner has two independent brakes:

1. Before every paid call it commits a reservation to the public ledger. Pending and unknown reservations keep their full value.
2. Every Apify run receives `maxTotalChargeUsd`.

The configured worst case is **$0.36 per weekly suite** and **$1.80 in a five-week month**. The hard UTC monthly cap is **$5**. Workflow retries reuse the same run key and do not call a tool twice.

## Run locally

Requirements: Node.js 24, an Apify token, and a checkout of the public data repo.

```bash
npm ci
npm test
APIFY_TOKEN=... node bin/canaryindex.mjs live \
  --public-repo /path/to/canaryindex \
  --run-key manual-my-test
node bin/canaryindex.mjs build --public-repo /path/to/canaryindex
```

The token is sent only in the `Authorization` header. A result containing credential-like text is refused before publication.

## Neutrality and corrections

CanaryIndex is published by the developer of the `dropin-apis` Actors included in the sample. That conflict is visible on every relevant card. Raw evidence, scorer version, fixture source and pricing inputs are public so mistakes can be reproduced.

Do not open an issue on a third-party Actor merely because a canary fails. A failed fixture is evidence about one observation—not proof the whole product is bad. CanaryIndex never contacts or posts about other publishers automatically.

## License

MIT. Fixture rights and source links are documented in [`config/canaries.json`](config/canaries.json).
