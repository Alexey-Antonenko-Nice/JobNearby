import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "JOB_BOARD",
  "RECRUITMENT_AGENCY",
  "EMPLOYER_WEBSITE",
  "PUBLIC_API",
  "PUBLIC_REGISTER",
  "EMAIL",
  "MANUAL",
  "BROWSER_CAPTURE",
  "OTHER",
]);

export const sourceReferenceSchema = z.object({
  sourceType: sourceTypeSchema,

  sourceName: z.string().trim().min(1, "Source name is required."),

  sourceUrl: z.url().optional(),

  externalId: z.string().trim().min(1).optional(),

  providerMetadata: z.record(z.string(), z.unknown()).optional(),
});
