# CanaryIndex method v1.0.0

## Claim boundary

CanaryIndex observes whether one published Actor build handled one fixed public fixture at one time. It does **not** certify security, privacy, legal compliance, universal correctness or future availability.

## Quality

### PDF text-layer → Markdown

The normalized output must contain `dummy`, `pdf`, and `file`. Quality is exact expected-token recall. The pass threshold is 0.80; this three-token fixture therefore requires all three tokens. It measures extraction, not sophisticated Markdown layout.

### Direct audio/video → text

Quality is `max(0, 1 − WER)`, where WER is word-level Levenshtein distance divided by reference word count. Unicode is NFKC-normalized, casing and punctuation are removed, and apostrophes do not split words. The historic recording is ambiguous, so the method publishes two reference interpretations and uses the lower WER. The pass threshold is 0.70.

## Cost

Authenticated run data supplies `chargedEventCounts`. Event prices come from the pricing snapshot returned by the run or the exact current Store item. v0.1 publishes a clearly labeled **FREE-tier list-price estimate** so different tools are compared on one reproducible tier; this may differ from a paid-plan buyer's invoice. Start events are not hidden. If platform usage is explicitly buyer-paid, `usageTotalUsd` is added.

Apify does not charge a developer their own custom Actor events. For publisher-owned tools, the scorecard therefore shows both:

- the observed account spend from `usageTotalUsd`; and
- a labeled public-buyer simulation that applies the public event price to delivered fixture units.

Unknown cost is displayed as unknown; it is never replaced with zero.

## Reliability and routing

Reliability is accepted observations divided by completed observations. Missing scheduled evidence is never a pass. Effective cost per accepted unit includes comparative cost from failed completed observations in the numerator.

Recommendations require a public listing and a latest passing canary. Sponsorship, payment, affiliate status and publisher ownership are excluded from all routing functions.

## Budget accounting

Each call's configured maximum is committed as a pending public reservation before the call. CanaryIndex refuses to call any Actor not proven to use PAY_PER_EVENT, because Apify's `maxTotalChargeUsd` does not cap other pricing models. A stable authenticated final run may reduce the reservation to measured account spend. A crash, timeout, or unstable cost leaves the full reservation; a five-minute run timeout triggers an abort request. The monthly UTC cap is $5; current v0.1 reservations total no more than $0.36 per suite.

## Selection

Initial tools are the highest-used compatible Actors found through public Store data, not merely the first text-search matches. The categories deliberately exclude functionally different tools. Store usage and ratings select candidates but never affect quality scores.
