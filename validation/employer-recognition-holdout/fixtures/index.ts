import type { EmployerRecognitionHoldoutFixture } from "../types.js";

const observedAt = new Date("2026-08-27T08:00:00.000Z");

function fixture(
  input: Omit<EmployerRecognitionHoldoutFixture, "observedAt" | "metadata">,
): EmployerRecognitionHoldoutFixture {
  return { ...input, observedAt, metadata: {} };
}

export const employerRecognitionHoldoutFixtures: readonly EmployerRecognitionHoldoutFixture[] = [
  fixture({
    id: "holdout-4454269228",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "4454269228" },
    title: "Technicien maintenance projets",
    locationText: "Strasbourg",
    description: "Site industriel pharmaceutique. Maintenance, projets, utilités, nouveaux équipements et mise en service.",
  }),
  fixture({
    id: "holdout-4448033515",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "4448033515" },
    title: "Technicien maintenance industrielle",
    locationText: "Strasbourg",
    description: "Environnement de production pharmaceutique. Suivi des utilités, installation d'équipements et commissioning.",
  }),
  fixture({
    id: "holdout-4445142611",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "4445142611" },
    title: "Technicien installation et SAV",
    locationText: "Strasbourg",
    description: "Installation et service après-vente de solutions mobiles de reprographie, impression et dématérialisation.",
  }),
  fixture({
    id: "holdout-loxam-strasbourg",
    source: { sourceType: "JOB_BOARD", sourceName: "HelloWork", externalId: "holdout-loxam-strasbourg" },
    title: "Technicien de maintenance matériels d'élévation",
    displayedCompanyName: "LOXAM",
    locationText: "Strasbourg",
    description: "Maintenance, réparation et contrôles réglementaires des matériels d'élévation.",
  }),
  fixture({
    id: "holdout-loxam-haguenau",
    source: { sourceType: "JOB_BOARD", sourceName: "Meteojob", externalId: "holdout-loxam-haguenau" },
    title: "Responsable d'agence",
    displayedCompanyName: "LOXAM",
    locationText: "Haguenau",
    description: "Agence de location de matériels pour le bâtiment, les travaux publics et l'industrie.",
  }),
  fixture({
    id: "holdout-cerelia-hoerdt",
    source: { sourceType: "JOB_BOARD", sourceName: "HelloWork", externalId: "holdout-cerelia-hoerdt" },
    title: "Technicien de maintenance",
    displayedCompanyName: "Cérélia",
    locationText: "Hoerdt",
    description: "Site de production alimentaire. Maintenance en équipe, GMAO, fiabilisation et amélioration des installations.",
  }),
  fixture({
    id: "holdout-tir-technologies-kilstett",
    source: { sourceType: "EMPLOYER_WEBSITE", sourceName: "TIR Technologies", externalId: "holdout-tir-kilstett" },
    title: "Technicien maintenance industrielle",
    displayedCompanyName: "TIR Technologies",
    locationText: "Kilstett",
    description: "Fabrication de solutions de protection solaire, fermetures et moustiquaires.",
  }),
  fixture({
    id: "holdout-apave-strasbourg",
    source: { sourceType: "EMPLOYER_WEBSITE", sourceName: "Apave", externalId: "holdout-apave-strasbourg" },
    title: "Technicien inspection équipements",
    displayedCompanyName: "Apave",
    locationText: "Strasbourg",
    description: "Inspection et contrôles réglementaires d'équipements et de machines chez les clients.",
  }),
  fixture({
    id: "holdout-logic-interim-lifting-client",
    source: { sourceType: "RECRUITMENT_AGENCY", sourceName: "Logic Intérim", externalId: "holdout-logic-lifting" },
    title: "Technicien de maintenance engins",
    displayedCompanyName: "Logic Intérim",
    locationText: "Strasbourg",
    description: "Pour notre client, maintenance et réparation de matériels d'élévation. Réalisation des contrôles réglementaires.",
  }),
  fixture({
    id: "holdout-hays-anonymous-erstein",
    source: { sourceType: "RECRUITMENT_AGENCY", sourceName: "Hays", externalId: "holdout-hays-erstein" },
    title: "Technicien de maintenance industrielle",
    displayedCompanyName: "Hays",
    locationText: "Erstein",
    description: "Notre client recherche un technicien pour la maintenance préventive et curative des équipements industriels.",
  }),
  fixture({
    id: "holdout-hays-anonymous-saverne",
    source: { sourceType: "RECRUITMENT_AGENCY", sourceName: "Hays", externalId: "holdout-hays-saverne" },
    title: "Technicien de maintenance",
    displayedCompanyName: "Hays",
    locationText: "Saverne",
    description: "Notre client recrute pour assurer le diagnostic, le dépannage et la maintenance d'installations industrielles.",
  }),
  fixture({
    id: "holdout-cezam-anonymous-industrial-client",
    source: { sourceType: "RECRUITMENT_AGENCY", sourceName: "Cezam", externalId: "holdout-cezam-industrial" },
    title: "Technicien de maintenance industrielle",
    displayedCompanyName: "Cezam",
    locationText: "Strasbourg Nord",
    description: "Pour notre client, site de production industrielle : travail en équipe, GMAO, fiabilisation et amélioration continue.",
  }),
];
