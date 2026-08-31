import type {
  EmployerCharacteristicEvidence,
  EvidenceSpecificity,
} from "../evidence/EmployerCharacteristicEvidence.js";
import type { ExtractedVacancyEvidence } from "../evidence/ExtractedVacancyEvidence.js";
import type { LocationEvidence } from "../evidence/LocationEvidence.js";
import {
  normalizeOrganizationEvidenceName,
  type OrganizationEvidence,
} from "../evidence/OrganizationEvidence.js";
import type {
  EmployerEvidenceComparison,
  EmployerMatchContradiction,
  EmployerMatchSignal,
  MatchSignalStrength,
} from "./EmployerEvidenceComparison.js";
import { areEmployerIndustriesIncompatible } from "./EmployerIndustryCompatibility.js";

export function compareEmployerEvidence(
  left: ExtractedVacancyEvidence,
  right: ExtractedVacancyEvidence,
): EmployerEvidenceComparison {
  const positiveSignals: EmployerMatchSignal[] = [];
  const contradictions: EmployerMatchContradiction[] = [];

  compareOrganizations(
    left.organizations,
    right.organizations,
    positiveSignals,
    contradictions,
  );
  compareLocations(left.locations, right.locations, positiveSignals);
  compareCharacteristics(
    left.employerCharacteristics,
    right.employerCharacteristics,
    positiveSignals,
    contradictions,
  );

  return { positiveSignals, contradictions };
}

function compareOrganizations(
  left: readonly OrganizationEvidence[],
  right: readonly OrganizationEvidence[],
  signals: EmployerMatchSignal[],
  contradictions: EmployerMatchContradiction[],
): void {
  const leftEmployers = uniqueOrganizations(left.filter(({ role }) => role === "EMPLOYER"));
  const rightEmployers = uniqueOrganizations(right.filter(({ role }) => role === "EMPLOYER"));

  for (const leftEmployer of leftEmployers) {
    const rightEmployer = rightEmployers.find(
      (candidate) => organizationNameKey(candidate) === organizationNameKey(leftEmployer),
    );
    if (rightEmployer !== undefined) {
      signals.push({
        kind: "EMPLOYER_IDENTITY",
        strength: "VERY_STRONG",
        explanation: `Same explicit employer: ${leftEmployer.value}.`,
        leftEvidence: leftEmployer,
        rightEvidence: rightEmployer,
      });
    }
  }

  if (
    leftEmployers.length === 1 &&
    rightEmployers.length === 1 &&
    organizationNameKey(leftEmployers[0]!) !== organizationNameKey(rightEmployers[0]!)
  ) {
    contradictions.push({
      kind: "EMPLOYER_IDENTITY",
      strength: "DECISIVE",
      explanation: `Different explicit employers: ${leftEmployers[0]!.value} versus ${rightEmployers[0]!.value}.`,
      leftEvidence: leftEmployers[0]!,
      rightEvidence: rightEmployers[0]!,
    });
  }

  compareAmbiguousOrganizations(left, right, signals);

  const intermediaryRoles = ["RECRUITMENT_AGENCY", "STAFFING_AGENCY"] as const;
  for (const role of intermediaryRoles) {
    const leftIntermediaries = uniqueOrganizations(left.filter((item) => item.role === role));
    const rightIntermediaries = uniqueOrganizations(right.filter((item) => item.role === role));
    for (const leftIntermediary of leftIntermediaries) {
      const rightIntermediary = rightIntermediaries.find(
        (candidate) => organizationNameKey(candidate) === organizationNameKey(leftIntermediary),
      );
      if (rightIntermediary !== undefined) {
        signals.push({
          kind: "INTERMEDIARY_CONTEXT",
          strength: "WEAK",
          explanation: `Same ${role.toLocaleLowerCase().replaceAll("_", " ")}: ${leftIntermediary.value}.`,
          leftEvidence: leftIntermediary,
          rightEvidence: rightIntermediary,
        });
      }
    }
  }
}

function compareAmbiguousOrganizations(
  left: readonly OrganizationEvidence[],
  right: readonly OrganizationEvidence[],
  signals: EmployerMatchSignal[],
): void {
  const eligibleRoles = new Set(["EMPLOYER", "UNKNOWN"]);
  const leftEligible = preferExplicitEmployer(
    left.filter(({ role }) => eligibleRoles.has(role)),
  );
  const rightEligible = preferExplicitEmployer(
    right.filter(({ role }) => eligibleRoles.has(role)),
  );

  for (const leftOrganization of leftEligible) {
    const rightOrganization = rightEligible.find(
      (candidate) => organizationNameKey(candidate) === organizationNameKey(leftOrganization),
    );
    if (
      rightOrganization === undefined ||
      (leftOrganization.role === "EMPLOYER" &&
        rightOrganization.role === "EMPLOYER") ||
      (leftOrganization.role === "UNKNOWN" &&
        hasExplicitIntermediaryRole(left, leftOrganization)) ||
      (rightOrganization.role === "UNKNOWN" &&
        hasExplicitIntermediaryRole(right, rightOrganization))
    ) {
      continue;
    }

    signals.push({
      kind: "EMPLOYER_IDENTITY",
      strength: "STRONG",
      explanation:
        leftOrganization.role === "UNKNOWN" &&
        rightOrganization.role === "UNKNOWN"
          ? `Same organization with unknown role: ${leftOrganization.value}.`
          : `Same organization across employer and unknown roles: ${leftOrganization.value}.`,
      leftEvidence: leftOrganization,
      rightEvidence: rightOrganization,
    });
  }
}

function preferExplicitEmployer(
  organizations: readonly OrganizationEvidence[],
): OrganizationEvidence[] {
  const values = new Map<string, OrganizationEvidence>();
  for (const organization of organizations) {
    const key = organizationNameKey(organization);
    const current = values.get(key);
    if (current === undefined || organization.role === "EMPLOYER") {
      values.set(key, organization);
    }
  }
  return [...values.values()];
}

function hasExplicitIntermediaryRole(
  organizations: readonly OrganizationEvidence[],
  evidence: OrganizationEvidence,
): boolean {
  return organizations.some(
    (organization) =>
      (organization.role === "RECRUITMENT_AGENCY" ||
        organization.role === "STAFFING_AGENCY" ||
        organization.role === "RECRUITER" ||
        organization.role === "CONSULTANCY") &&
      organizationNameKey(organization) === organizationNameKey(evidence),
  );
}

function organizationNameKey(evidence: OrganizationEvidence): string {
  return evidence.normalizedName ?? normalizeOrganizationEvidenceName(evidence.value);
}

function compareLocations(
  left: readonly LocationEvidence[],
  right: readonly LocationEvidence[],
  signals: EmployerMatchSignal[],
): void {
  const roles = [
    { role: "WORKPLACE", strength: "MEDIUM" },
    { role: "EMPLOYER_LOCATION", strength: "MEDIUM" },
    { role: "DISPLAYED_LOCATION", strength: "WEAK" },
  ] as const;

  for (const { role, strength } of roles) {
    const leftLocations = uniqueLocations(left.filter((item) => item.role === role));
    const rightLocations = uniqueLocations(right.filter((item) => item.role === role));
    for (const leftLocation of leftLocations) {
      const rightLocation = rightLocations.find(
        ({ value }) => normalize(value) === normalize(leftLocation.value),
      );
      if (rightLocation !== undefined) {
        signals.push({
          kind: "LOCATION",
          strength,
          explanation: `Same ${role.toLocaleLowerCase().replaceAll("_", " ")}: ${leftLocation.value}.`,
          leftEvidence: leftLocation,
          rightEvidence: rightLocation,
        });
      }
    }
  }
}

function compareCharacteristics(
  left: readonly EmployerCharacteristicEvidence[],
  right: readonly EmployerCharacteristicEvidence[],
  signals: EmployerMatchSignal[],
  contradictions: EmployerMatchContradiction[],
): void {
  for (const leftCharacteristic of uniqueCharacteristics(left)) {
    const rightCharacteristic = uniqueCharacteristics(right).find(
      (candidate) =>
        candidate.category === leftCharacteristic.category &&
        normalize(candidate.value) === normalize(leftCharacteristic.value),
    );
    if (rightCharacteristic !== undefined) {
      signals.push({
        kind: "CHARACTERISTIC",
        strength: weakerSpecificityStrength(
          leftCharacteristic.specificity,
          rightCharacteristic.specificity,
        ),
        explanation: `Same ${leftCharacteristic.category.toLocaleLowerCase().replaceAll("_", " ")} characteristic: ${leftCharacteristic.value}.`,
        leftEvidence: leftCharacteristic,
        rightEvidence: rightCharacteristic,
      });
    }
  }

  const leftIndustries = left.filter(({ category }) => category === "INDUSTRY");
  const rightIndustries = right.filter(({ category }) => category === "INDUSTRY");
  for (const leftIndustry of leftIndustries) {
    for (const rightIndustry of rightIndustries) {
      if (
        areEmployerIndustriesIncompatible(
          leftIndustry.value,
          rightIndustry.value,
        )
      ) {
        contradictions.push({
          kind: "CHARACTERISTIC",
          strength: "STRONG",
          explanation: `Conflicting concrete industries: ${leftIndustry.value} versus ${rightIndustry.value}.`,
          leftEvidence: leftIndustry,
          rightEvidence: rightIndustry,
        });
      }
    }
  }
}

function weakerSpecificityStrength(
  left: EvidenceSpecificity,
  right: EvidenceSpecificity,
): MatchSignalStrength {
  const order: readonly EvidenceSpecificity[] = [
    "VERY_LOW",
    "LOW",
    "MEDIUM",
    "HIGH",
    "VERY_HIGH",
  ];
  const weaker = order[Math.min(order.indexOf(left), order.indexOf(right))]!;
  const mapping: Record<EvidenceSpecificity, MatchSignalStrength> = {
    VERY_LOW: "WEAK",
    LOW: "WEAK",
    MEDIUM: "MEDIUM",
    HIGH: "STRONG",
    VERY_HIGH: "VERY_STRONG",
  };
  return mapping[weaker];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function uniqueOrganizations(
  evidence: readonly OrganizationEvidence[],
): OrganizationEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = organizationNameKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueLocations(evidence: readonly LocationEvidence[]): LocationEvidence[] {
  return uniqueByNormalizedValue(evidence);
}

function uniqueCharacteristics(
  evidence: readonly EmployerCharacteristicEvidence[],
): EmployerCharacteristicEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.category}\u0000${normalize(item.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueByNormalizedValue<T extends { readonly value: string }>(
  evidence: readonly T[],
): T[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = normalize(item.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
