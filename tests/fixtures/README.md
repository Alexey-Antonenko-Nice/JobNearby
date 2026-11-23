# Test fixtures

Fixtures are **minimal regression evidence**, not saved web pages. Each file exists to
prove one piece of provider behaviour (route identity, selected-pane isolation, salary
semantics, agency wording, JSON-LD extraction, and so on).

The regression suites read these files directly. Changing one is a behaviour change:
run its consumers before committing.

## Rules

1. **Prefer synthetic, then minimized, then real-derived.** A full captured page is an
   exception that needs a reason, not the default.
2. **Keep only the evidence the assertions need.** Remove page chrome, navigation,
   cookie/consent banners, ads, recommendations, unrelated vacancies, footers, styles,
   analytics and unrelated prose.
3. **Remove scripts and styles.** Fixtures must be inert. Only
   `<script type="application/ld+json">` may remain, because structured-data tests parse
   it. Remove inline CSS unless a visibility/bounding test genuinely needs the rule.
4. **No real personal contact data.** Replace recruiter/hiring-manager names and direct
   addresses with synthetic values. Company and provider names may stay: they are the
   regression subject.
5. **Use reserved domains for invented data.** `example.test` for emails
   (`recruiter@example.test`), never a real company or free-mail domain. Keep an email
   address only when the test parses it.
6. **Use obviously synthetic phone numbers.** `01 00 00 00 00` or `06 00 00 00 00`.
   Do not keep real switchboards or mobile numbers.
7. **Strip tracking and session parameters.** Keep query parameters that define vacancy
   identity (`jk=`, `id=`, `currentJobId=`), drop `utm_*`, click IDs, session IDs,
   referral tokens and cookie/authorization material. Sidecar `.meta.json` files store a
   canonical provider URL, not the captured tracking URL.
8. **Real public job/requisition IDs may stay** when they are the regression evidence
   (for example a Workday `JR` number or a provider route ID). Remove unrelated IDs.
9. **Truncate copied prose.** Keep the shortest fragment that triggers the behaviour;
   do not reproduce whole vacancy descriptions.
10. **State provenance briefly.** If a fixture is partly real-derived, a short comment
    is enough: "Minimal regression fixture derived from a publicly accessible vacancy
    page; nonessential prose and personal/contact data removed." Never imply permission
    or endorsement.

## Size budget

- Normal fixture: **under 100 KB**.
- Exceptional fixture: **under 250 KB**, and it must have a narrow entry in
  `tools/checkFixtures.cjs` explaining why it cannot be smaller.
- Multi-megabyte captures are rejected.

## Checks

```text
npm run check:fixtures    # size, real contact data, tracking/session material, dumps
npm run check:repo        # tracked artifacts, local databases, high-confidence secrets
```

Both fail on public-release blockers and print file + rule + reason. The fixture allowlist
is deliberately narrow: it may exempt an **oversize** fixture only, never a privacy rule.

Do not add `.test` or library code here; this directory is data consumed by tests.
