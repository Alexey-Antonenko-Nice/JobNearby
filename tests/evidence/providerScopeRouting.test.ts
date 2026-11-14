import { describe, expect, it } from "vitest";
import { ProviderCaptureRegistry } from "../../src/application/acquisition/ProviderCaptureRegistry.js";
import { hasExplicitVacancyEvidenceScopeRoute } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import type { ProviderKey } from "../../src/domain/acquisition/ProviderKey.js";

interface Sample { readonly sourceName: string; readonly sourceUrl: string }

const host = (name: string, path = "/job/1"): Sample => ({ sourceName: name, sourceUrl: `https://${name}${path}` });

// Record<ProviderKey, ...> forces a sample (and thus a routing review) for every new provider key.
const samples: Readonly<Record<ProviderKey, Sample>> = {
  FRANCE_TRAVAIL: host("candidat.francetravail.fr", "/offres/recherche/detail/213CWRC"),
  INDEED: { sourceName: "indeed.com", sourceUrl: "https://fr.indeed.com/viewjob?jk=abcdef0123456789" },
  LINKEDIN: { sourceName: "linkedin.com", sourceUrl: "https://www.linkedin.com/jobs/view/1234567890/" },
  JOOBLE: host("jooble.org"),
  CADREMPLOI: host("cadremploi.fr"),
  LHH: { sourceName: "lhh.com", sourceUrl: "https://www.lhh.com/fr-fr/emploi/1" },
  PERSONIO: { sourceName: "acme.jobs.personio.de", sourceUrl: "https://acme.jobs.personio.de/job/123" },
  HELLOWORK: { sourceName: "hellowork.com", sourceUrl: "https://www.hellowork.com/fr-fr/emplois/1.html" },
  TALENT: { sourceName: "talent.com", sourceUrl: "https://fr.talent.com/view?id=abc" },
  ADECCO: { sourceName: "adecco.com", sourceUrl: "https://www.adecco.com/job/1" },
  MANPOWER: { sourceName: "manpower.com", sourceUrl: "https://www.manpower.com/job/1" },
  RANDSTAD: { sourceName: "randstad.fr", sourceUrl: "https://www.randstad.fr/job/1" },
  SYNERGIE: { sourceName: "synergie.fr", sourceUrl: "https://www.synergie.fr/job/1" },
  CRIT: { sourceName: "crit-job.com", sourceUrl: "https://www.crit-job.com/job/1" },
  ACTUAL: { sourceName: "actualgroup.com", sourceUrl: "https://www.actualgroup.com/job/1" },
  START_PEOPLE: { sourceName: "startpeople.fr", sourceUrl: "https://www.startpeople.fr/job/1" },
  PROMAN: host("mon-espace.proman-emploi.fr"),
  GI_GROUP: { sourceName: "gigroup.com", sourceUrl: "https://fr.gigroup.com/job/1" },
  STELLANTIS: host("jobs.groupe-psa.com"),
  GREENHOUSE: host("job-boards.eu.greenhouse.io"),
  ORANO: host("jobs.orano.group"),
  MICHAEL_PAGE: { sourceName: "michaelpage.fr", sourceUrl: "https://www.michaelpage.fr/job-detail/x/ref/1" },
  RENAULT_WORKDAY: host("alliancewd.wd3.myworkdayjobs.com", "/fr-FR/renault-group-careers/job/x_JOBREQ_1"),
  KELLY_WORKDAY: host("kellyservices.wd503.myworkdayjobs.com", "/en-US/corporatecareers-kellyservices-com/details/x_123"),
  APEC: { sourceName: "apec.fr", sourceUrl: "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/123" },
  DIRECT_EMPLOI: { sourceName: "directemploi.com", sourceUrl: "https://www.directemploi.com/offre/1" },
  ALSTOM: host("jobsearch.alstom.com"),
  HAYS: host("m.hays.fr"),
  EXPECTRA_MONACO: { sourceName: "expectra.mc", sourceUrl: "https://www.expectra.mc/offre/1" },
};

type RouteCheck = (sample: Sample) => boolean;
const registry = new ProviderCaptureRegistry();
const captured = (key: ProviderKey) => ({ key, sample: samples[key], result: registry.capture(samples[key]) });
const requiringKeys = (Object.keys(samples) as ProviderKey[]).filter((key) => captured(key).result.requiresSelectedVacancyContext === true);

/** Providers that require selected-vacancy context but have no explicit scope route. */
function unroutedSelectedContextProviders(hasRoute: RouteCheck): ProviderKey[] {
  return requiringKeys.filter((key) => !hasRoute(samples[key]));
}

const production: RouteCheck = (sample) => hasExplicitVacancyEvidenceScopeRoute(sample.sourceName, sample.sourceUrl);

describe("provider vacancy-evidence scope routing", () => {
  it("recognizes each sample as its own provider key", () => {
    for (const key of Object.keys(samples) as ProviderKey[]) expect(captured(key).result.providerKey, key).toBe(key);
  });

  it("gives every provider that requires selected-vacancy context an explicit scope route", () => {
    expect(requiringKeys.length).toBeGreaterThan(20);
    expect(unroutedSelectedContextProviders(production)).toEqual([]);
  });

  it("fails the invariant when a required provider's route is missing", () => {
    const withoutFranceTravail: RouteCheck = (sample) => sample.sourceName !== samples.FRANCE_TRAVAIL.sourceName && production(sample);
    expect(unroutedSelectedContextProviders(withoutFranceTravail)).toEqual(["FRANCE_TRAVAIL"]);
    const withoutHelloWork: RouteCheck = (sample) => sample.sourceName !== "hellowork.com" && production(sample);
    expect(unroutedSelectedContextProviders(withoutHelloWork)).toEqual(["HELLOWORK"]);
  });

  it.each(["FRANCE_TRAVAIL", "LINKEDIN", "INDEED", "LHH", "HELLOWORK", "RENAULT_WORKDAY", "KELLY_WORKDAY", "PERSONIO"] as const)(
    "routes %s explicitly", (key) => {
      expect(production(samples[key]), key).toBe(true);
    });

  it("requires selected context for France Travail, LHH and HelloWork", () => {
    for (const key of ["FRANCE_TRAVAIL", "LHH", "HELLOWORK", "PERSONIO"] as const) expect(requiringKeys).toContain(key);
  });

  it("does not reject providers that do not require selected context", () => {
    for (const key of ["JOOBLE", "CADREMPLOI"] as const) {
      expect(requiringKeys, key).not.toContain(key);
      expect(production(samples[key]), key).toBe(false);
    }
    expect(unroutedSelectedContextProviders(production)).not.toContain("PERSONIO");
  });

  it("explicitly routes keyless providers that require selected context", () => {
    const keyless: Sample[] = [{ sourceName: "burkert.com", sourceUrl: "https://www.burkert.com/en/company-career/career/job-openings/some-job" }];
    for (const sample of keyless) {
      expect(registry.capture(sample).requiresSelectedVacancyContext, sample.sourceName).toBe(true);
      expect(production(sample), sample.sourceName).toBe(true);
    }
  });

  it("does not treat unknown sources as explicitly routed", () => {
    expect(hasExplicitVacancyEvidenceScopeRoute("example.org", "https://example.org/job/1")).toBe(false);
  });
});
