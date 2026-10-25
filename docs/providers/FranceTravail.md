# France Travail

Provider key `FRANCE_TRAVAIL`, host `candidat.francetravail.fr`, detail URLs
`/offres/recherche/(emploirecherche/)?detail/<ID>`.

## Selected vacancy boundary

`FranceTravailSelectedVacancyContextLocator` returns the single open
`div#PopinDetails.modal-details-offre.in`, but only when the URL ID, the active
result `li[data-id-offre]` and an independent reference in the pane (`Offre n° <ID>`
heading or `idOffre=<ID>` link) all agree. The whole pane is used, so the description,
"Critères de l'offre" and employer panel are included once they are in the HTML.
The background result list, navigation and other offers are outside the pane.

## Why the stored capture was incomplete

Observation `250bb3a8-2c27-4fb3-856f-9cd4db72bc98` was captured while the description
lived in an empty `<descriptif-offre>` web component. Its content was not in the saved
`outerHTML` or `innerText`, so only the pane header (638 characters) existed. The
locator was not at fault; the evidence never reached the server.

The browser extension (`captureDocumentSnapshot` in `browser-extension/popup.js`) now
clones the document and copies each open shadow root, recursively, under its host in a
`<div data-jn-shadow-root="open">` wrapper. The page itself is not modified. Closed
shadow roots remain invisible. Reload the extension after updating it, and capture
only after the description has rendered. Observation
`7b7d204f-b2f0-4456-a842-3c843499127e` is the first real capture with the shadow
content (4,054-character context, saved as `franceTravailRenderedDetail.*`). It
contains the description, "Critères de l’offre" and the "L'employeur" panel, and none
of the background results.

## Extracted facts

- Title, location (`OSTWALD (67)`) and `CDI` come from the generic header extractors.
- The name after the pane's `L'employeur` heading (`MOBALPA`) is displayed-company
  evidence only, never a confirmed employer or legal entity.
- `FranceTravailVacancyEvidenceExtractor` reads the `Salaire Annuel de 24000.0 Euros à
  55000.0 Euros` criterion (colon optional; annual, monthly or hourly; `.`/`,` decimals
  and space or dot thousands) into compensation: EUR 24,000–55,000 per year. The raw text
  also keeps the description's `Rémunération : entre 24K€ et 55K€ annuel … composée d'un
  fixe et d'une variable`, so the range is not a guaranteed base salary.
- "Actualisée le <date>" is not mapped to the publication date; the model has no
  update-date field.

## Unsupported by the model

- Weekly hours (`35H/semaine`) and day work: no field; the text stays in the context.
- Update date ("Actualisée le …").
- Fixed/variable split: only in the compensation raw text, not structured.

## Tests

`tests/acquisition/FranceTravailRenderedDetail.test.ts` uses the two real saved pages
(`franceTravailUnrenderedDetail.*`, `franceTravailRenderedDetail.*`).
`tests/acquisition/shadowRootCapture.test.js` covers the extension. Set
`FRANCETRAVAIL_STORED_REPLAY=1` to replay the stored observation on an in-memory copy
of `job-nearby.sqlite`.
