## What changed

<!-- Describe the focused change and the files/areas it touches. -->

## Why

<!-- The problem, user need, or issue this addresses. -->

## Testing

<!-- Commands run and results. Include focused tests and any broader suites. -->

```text
npm run typecheck
npm run build
npm run ui:build
```

## Risk and compatibility

<!-- Behavior changes, migration/compatibility considerations, backup/export impact, or "none". -->

## Security impact

Does this change affect any of the following?

- [ ] Loopback HTTP APIs, Host/Origin policy, or session authorization
- [ ] Extension permissions, pairing, or capture credentials
- [ ] Filesystem paths, backup/restore, or document handling
- [ ] Dependencies or native code

If yes, describe the security impact and the tests/checks performed. If no, say why not.

## Contributor checklist

- [ ] The change is focused and unrelated cleanup is not bundled into it.
- [ ] Tests were added or updated for behavior changes.
- [ ] No real/private database, backup, export, CV, contact data, token, or pairing code is included.
- [ ] Fixtures follow `tests/fixtures/README.md` and use synthetic or minimized data.
- [ ] Relevant hygiene and build checks were run (`npm run check:contributor`).
- [ ] License/provenance implications were reviewed for copied code, assets, or dependencies.
- [ ] Documentation was updated where behavior or contributor guidance changed.
- [ ] Screenshots, if any, redact vacancy, contact, and private CRM details.

## Screenshots (UI changes only)

<!-- Optional. Redact private data. -->
