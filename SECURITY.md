# Security and data handling

- The Apify token is read from `APIFY_TOKEN` and sent only through an `Authorization: Bearer` header.
- Published results are scanned for common credential patterns and rejected on a match.
- Canaries use fixed public fixtures. No user documents, recordings or personal data are processed.
- Raw output is public by design; do not replace fixtures with private material.
- The workflow uses a repository-specific SSH deploy key. It does not reuse the documentation site's deploy key.
- A public budget reservation is committed before every paid call. Pending reservations fail closed.

Report a vulnerability privately through GitHub's security-advisory feature. Do not include credentials in a report.
