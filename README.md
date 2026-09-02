# Job Nearby

Job Nearby is a free and open-source company-first job-search intelligence application.

It processes vacancy publications from multiple sources, recognizes the real employers behind them, remembers previously encountered employers and gradually builds a structured view of the local labor market.

## Core idea

Job Nearby treats vacancy publications as evidence rather than as unique vacancies.

The project distinguishes:

- source publications;
- publication families;
- employer clusters;
- resolved employers;
- recruitment campaigns;
- private job-seeker interaction history.

An employer cluster may exist even when the employer's actual name is still unknown.

## Status

Early architecture and domain-design phase.

The initial implementation will focus on:

1. immutable source observation capture;
2. employer-cluster recognition;
3. employer identity resolution;
4. recognition explanations and human correction;
5. job-seeker interaction history.

## Documentation

- `docs/PRODUCT_SPECIFICATION.md`
- `docs/RECOGNITION_MODEL.md`
- `docs/DATA_MODEL.md`
- `docs/ARCHITECTURE.md`

## Technology

Initial direction:

- TypeScript
- Node.js
- Vitest
- SQLite
- React later for the web interface

## Local vacancy review UI

Start the API server in one terminal:

```text
npm run capture:server
```

Start the local UI in another:

```text
npm run ui:dev
```

Open `http://127.0.0.1:5173/review/<canonicalVacancyId>`, replacing the ID with a
canonical vacancy ID stored by the capture workflow. Opening this page is read-only;
only an explicit action button creates a private interaction event. The API allows
this fixed local UI origin in addition to supported browser-extension origins.

## License

To be decided before public release.